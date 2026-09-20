package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	_ "awesomeProject/migrations"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/types"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const (
	autoVersionTitle    = "当前版本"
	autoSourcePrefix    = "[AUTO_SOURCE]"
	mappingFileName     = "prototype_scan_mapping.json"
	defaultCreatorEmail = "admin@example.com"
)

type scanMapping struct {
	Projects map[string]string `json:"projects"`
	Versions map[string]string `json:"versions"`
}

type syncSummary struct {
	ScannedProjects int      `json:"scanned_projects"`
	SyncedProjects  int      `json:"synced_projects"`
	CreatedProjects int      `json:"created_projects"`
	UpdatedProjects int      `json:"updated_projects"`
	DeletedProjects int      `json:"deleted_projects"`
	CreatedVersions int      `json:"created_versions"`
	UpdatedVersions int      `json:"updated_versions"`
	SkippedPaths    []string `json:"skipped_paths"`
}

var errSourceDirNotConfigured = errors.New("未配置 PROTOTYPE_SOURCE_DIR，无法扫描原型目录")

func getEffectiveSourceDir() string {
	if s := strings.TrimSpace(os.Getenv("PROTOTYPE_SOURCE_DIR")); s != "" {
		return s
	}
	if info, err := os.Stat("/app/source-prototypes"); err == nil && info.IsDir() {
		return "/app/source-prototypes"
	}
	if info, err := os.Stat("/Users/laibin/Documents/jh_demand/shopkeeper"); err == nil && info.IsDir() {
		return "/Users/laibin/Documents/jh_demand/shopkeeper"
	}
	if info, err := os.Stat("/Users/laibin/Documents/shopkeeper"); err == nil && info.IsDir() {
		return "/Users/laibin/Documents/shopkeeper"
	}
	return ""
}

func main() {
	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		staticHandler := apis.Static(os.DirFS("./pb_public"), false)
		sourceDir := getEffectiveSourceDir()

		// 对响应体启用 gzip：原型目录里大量的 HTML/JS/CSS 通常能压掉 70% 以上。
		// 小于 1KB 的响应压缩后反而可能变大，直接跳过。
		gzipHandler := apis.GzipWithConfig(apis.GzipConfig{MinLength: 1024})
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			reqPath := e.Request.URL.Path

			// 前端强缓存：对 /api/files/（文件/封面/缩略图）启用 30 天浏览器本地强缓存
			if strings.HasPrefix(reqPath, "/api/files/") {
				e.Response.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
			} else if strings.HasPrefix(reqPath, "/assets/") {
				// 前端强缓存：对 Vite 打包静态资源（带有 hash）启用 1 年强缓存
				e.Response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}

			if isPrecompressedPath(reqPath) {
				return e.Next()
			}
			return gzipHandler.Func(e)
		})

		if sourceDir != "" {
			se.Router.GET("/linked-projects/{path...}", func(e *core.RequestEvent) error {
				relPath := e.Request.PathValue(apis.StaticWildcardParam)
				if err := ensureSafeLinkedProjectPath(relPath); err != nil {
					return e.BadRequestError("非法的预览路径", err)
				}

				e.Response.Header().Del("X-Frame-Options")
				e.Response.Header().Set("Content-Security-Policy", "frame-ancestors *")

				ext := strings.ToLower(filepath.Ext(relPath))
				if isRasterImage(ext) {
					// 原型内的图片资源启用前端强缓存
					e.Response.Header().Set("Cache-Control", "public, max-age=604800")
				} else {
					// HTML/JS/CSS 等代码文件启用协商缓存
					e.Response.Header().Set("Cache-Control", "no-cache, must-revalidate")
				}

				fullPath := filepath.Join(sourceDir, filepath.FromSlash(relPath))
				info, err := os.Stat(fullPath)
				if err != nil {
					// 智能容错：如果请求的具体 html（如 index.html）不存在，尝试查找该目录下的入口 html
					dir := filepath.Dir(fullPath)
					if dInfo, dErr := os.Stat(dir); dErr == nil && dInfo.IsDir() {
						entryFile := resolvePrototypeEntryHTML(dir)
						altPath := filepath.Join(dir, entryFile)
						if altInfo, altErr := os.Stat(altPath); altErr == nil && !altInfo.IsDir() {
							http.ServeFile(e.Response, e.Request, altPath)
							return nil
						}
					}
					return e.NotFoundError("文件不存在", err)
				}
				if info.IsDir() {
					entryFile := resolvePrototypeEntryHTML(fullPath)
					fullPath = filepath.Join(fullPath, entryFile)
				}

				http.ServeFile(e.Response, e.Request, fullPath)
				return nil
			})
		}

		se.Router.POST("/api/prototype-sync/scan", func(e *core.RequestEvent) error {
			if e.Auth == nil {
				return e.UnauthorizedError("需要登录后才能执行扫描。", nil)
			}

			creatorID, err := resolveCreatorID(e.App, e.Auth)
			if err != nil {
				return e.InternalServerError("无法确定默认创建人", err)
			}

			summary, err := syncPrototypeDirectories(e.App, creatorID)
			if err != nil {
				if errors.Is(err, errSourceDirNotConfigured) {
					return e.BadRequestError(err.Error(), nil)
				}
				log.Println("扫描原型目录失败:", err)
				return e.InternalServerError("扫描原型目录失败", err)
			}

			return e.JSON(http.StatusOK, summary)
		}).Bind(apis.RequireAuth())

		se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
			e.Response.Header().Del("X-Frame-Options")
			e.Response.Header().Set("Content-Security-Policy", "frame-ancestors *")

			requestPath := e.Request.PathValue(apis.StaticWildcardParam)
			cleanPath := strings.TrimPrefix(requestPath, "/")

			ext := strings.ToLower(filepath.Ext(cleanPath))
			if isRasterImage(ext) {
				// 图片静态资源启用前端强缓存（7天）
				e.Response.Header().Set("Cache-Control", "public, max-age=604800")
			} else if strings.HasPrefix(cleanPath, "projects/") {
				// 原型项目的 HTML/JS 代码启用协商缓存
				e.Response.Header().Set("Cache-Control", "no-cache, must-revalidate")
			}

			if shouldServeSPAIndex(requestPath) {
				http.ServeFile(e.Response, e.Request, filepath.Join("pb_public", "index.html"))
				return nil
			}

			return staticHandler(e)
		})
		return se.Next()
	})

	hookFunc := func(e *core.RecordEvent) error {
		log.Printf("===> 捕获到表 [%s] 的变动事件", e.Record.Collection().Name)

		if e.Record.Collection().Name != "rp_prototype" {
			return nil
		}

		if e.Record.GetBool("skip_diff_hook") {
			e.Record.Set("skip_diff_hook", false)
			log.Println("------ [防死循环] 拦截到系统后台更新 Diff 的保存，已直接跳过 ------")
			return nil
		}

		if isAutoPrototypeRecord(e.Record) {
			log.Println("------ 自动同步目录版本，跳过 ZIP 解压与 Diff 计算 ------")
			return nil
		}

		fileField := e.Record.GetString("file")
		log.Println("------ 进入处理钩子 ------")
		log.Println("当前上传的文件名为:", fileField)

		if fileField == "" {
			log.Println("警告：fileField 是空的，可能确实没有上传文件，或者字段不是 'file'")
			return nil
		}
		if !strings.HasSuffix(fileField, ".zip") {
			log.Println("跳过：文件不是 .zip 结尾:", fileField)
			return nil
		}

		dataDir := e.App.DataDir()
		collectionId := e.Record.Collection().Id
		recordId := e.Record.Id
		zipPath := filepath.Join(dataDir, "storage", collectionId, recordId, fileField)
		log.Println("目标 ZIP 路径:", zipPath)

		if _, err := os.Stat(zipPath); os.IsNotExist(err) {
			log.Println("错误：找不到 ZIP 文件路径 ->", zipPath)
			return nil
		}

		sourceDir := getEffectiveSourceDir()
		if sourceDir != "" {
			tryGitPull(sourceDir)

			projectName := "默认项目"
			var projectRelBase string
			if projectId := e.Record.GetString("project"); projectId != "" {
				if projRecord, err := e.App.FindRecordById("rp_project", projectId); err == nil {
					if name := strings.TrimSpace(projRecord.GetString("name")); name != "" {
						projectName = name
					}
					desc := projRecord.GetString("description")
					if strings.HasPrefix(desc, autoSourcePrefix+" ") {
						projectRelBase = strings.TrimSpace(strings.TrimPrefix(desc, autoSourcePrefix+" "))
					}
				}
			}

			versionTitle := strings.TrimSpace(e.Record.GetString("title"))
			if versionTitle == "" {
				versionTitle = "未命名版本"
			}
			cleanVersion := sanitizePathComponent(versionTitle)

			var targetRelDir string
			if projectRelBase != "" {
				// 若所选项目已有归档目录（例如 2026年11月/存量设备升级-美团单链需求），直接归入该项目名下！
				targetRelDir = filepath.Join(projectRelBase, cleanVersion)
			} else {
				now := time.Now()
				yearMonth := fmt.Sprintf("%d年%d月", now.Year(), int(now.Month()))
				cleanProject := sanitizePathComponent(projectName)
				targetRelDir = filepath.Join(yearMonth, cleanProject, cleanVersion)
			}

			targetDir := filepath.Join(sourceDir, filepath.FromSlash(targetRelDir))

			os.RemoveAll(targetDir)
			if err := os.MkdirAll(targetDir, os.ModePerm); err != nil {
				log.Printf("创建目标目录失败 [%s]: %v", targetDir, err)
			} else if err := unzip(zipPath, targetDir); err != nil {
				log.Printf("解压到目标目录失败 [%s]: %v", targetDir, err)
			} else {
				log.Printf("成功解压原型到 Git 目录: %s", targetDir)

				entryFile := resolvePrototypeEntryHTML(targetDir)
				linkedUrl := "/linked-projects/" + filepath.ToSlash(targetRelDir) + "/" + entryFile

				if e.Record.GetString("url") != linkedUrl {
					e.Record.Set("url", linkedUrl)
					e.Record.Set("skip_diff_hook", true)
					if err := e.App.Save(e.Record); err != nil {
						log.Println("更新 url 字段失败:", err)
					} else {
						log.Println("更新 url 字段成功:", linkedUrl)
					}
				}

				go func() {
					if err := tryGitCommitAndPush(sourceDir, targetRelDir, projectName, versionTitle); err != nil {
						log.Printf("[Git] 自动提交推送失败: %v", err)
					}
				}()
			}
		} else {
			destDir := filepath.Join("pb_public", "projects", recordId)

			os.RemoveAll(destDir)
			os.MkdirAll(destDir, os.ModePerm)
			log.Println("准备解压到文件夹:", destDir)

			if err := unzip(zipPath, destDir); err != nil {
				log.Println("解压失败:", err)
				return nil
			}
			log.Println("解压成功！")

			entryFile := resolvePrototypeEntryHTML(destDir)
			foundIndexPath := "/projects/" + recordId + "/" + entryFile

			if e.Record.GetString("url") != foundIndexPath {
				e.Record.Set("url", foundIndexPath)
				e.Record.Set("skip_diff_hook", true)
				if err := e.App.Save(e.Record); err != nil {
					log.Println("更新 url 字段失败:", err)
				} else {
					log.Println("更新 url 字段成功:", foundIndexPath)
				}
			}
		}

		if projectId := e.Record.GetString("project"); projectId != "" {
			if projRecord, err := e.App.FindRecordById("rp_project", projectId); err == nil {
				if projRecord.GetDateTime("folder_time").IsZero() || !isAutoPrototypeRecord(e.Record) {
					projRecord.Set("folder_time", types.NowDateTime())
					if err := e.App.Save(projRecord); err != nil {
						log.Printf("更新项目 folder_time 失败 [%s]: %v", projectId, err)
					}
				}
			}
		}

		go func(app core.App, record *core.Record) {
			log.Println("[后台任务] 开始异步处理流程...")
			if err := recalculateDiffForRecord(app, record); err != nil {
				log.Println("[后台任务] 最终保存记录失败:", err)
			} else {
				log.Println("[后台任务] 所有后台处理已完成。")
			}
		}(e.App, e.Record)

		return nil
	}

	app.OnRecordCreate("rp_project").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetDateTime("folder_time").IsZero() {
			e.Record.Set("folder_time", types.NowDateTime())
		}
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess().BindFunc(hookFunc)
	app.OnRecordAfterUpdateSuccess().BindFunc(hookFunc)

	app.OnRecordAfterDeleteSuccess().BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Collection().Name != "rp_prototype" {
			return nil
		}

		projectId := e.Record.GetString("project")
		recordId := e.Record.Id

		os.RemoveAll(filepath.Join("pb_public", "projects", recordId))
		log.Printf("已清理被删除记录 (%s) 的文件夹", recordId)

		if projectId == "" {
			return nil
		}

		nextRecords, err := e.App.FindRecordsByFilter(
			"rp_prototype",
			"project = {:project} && id != {:id} && created > {:created}",
			"+created",
			1,
			0,
			map[string]any{
				"project": projectId,
				"id":      recordId,
				"created": e.Record.GetDateTime("created").String(),
			},
		)

		if err == nil && len(nextRecords) > 0 {
			nextRecord := nextRecords[0]
			log.Printf("检测到版本 B(%s) 被删除，开始为下个版本 C(%s) 重新计算差异...", recordId, nextRecord.Id)
			go func(app core.App, record *core.Record) {
				if err := recalculateDiffForRecord(app, record); err != nil {
					log.Println("重新计算 Diff 失败:", err)
				}
			}(e.App, nextRecord)
		}
		return nil
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// resolvePhysicalDirectoryForPrototype: 解析版本记录对应的物理目录路径（支持 linked-projects 与 pb_public）
func resolvePhysicalDirectoryForPrototype(record *core.Record) string {
	url := record.GetString("url")
	if strings.HasPrefix(url, "/linked-projects/") {
		sourceDir := getEffectiveSourceDir()
		if sourceDir != "" {
			rel := strings.TrimPrefix(url, "/linked-projects/")
			full := filepath.Join(sourceDir, filepath.FromSlash(rel))
			if info, err := os.Stat(full); err == nil {
				if info.IsDir() {
					return full
				}
				return filepath.Dir(full)
			}
			return filepath.Dir(full)
		}
	}
	destDir := filepath.Join("pb_public", "projects", record.Id)
	if _, err := os.Stat(destDir); err == nil {
		return destDir
	}
	return ""
}

// recalculateDiffForRecord : 辅助函数：负责为传入的 currentRecord 寻找其历史前任，并计算和保存 Diff
func recalculateDiffForRecord(app core.App, currentRecord *core.Record) error {
	projectId := currentRecord.GetString("project")
	if projectId == "" {
		return nil
	}

	recordId := currentRecord.Id
	destDir := resolvePhysicalDirectoryForPrototype(currentRecord)
	if destDir == "" {
		destDir = filepath.Join("pb_public", "projects", recordId)
	}
	var oldDestDir string

	log.Printf("所属项目 ID: %s，正在为 %s 查找历史版本 (当前目录: %s)...", projectId, recordId, destDir)

	// 查找该项目下，创建时间早于当前记录的最新一条数据
	prevRecords, err := app.FindRecordsByFilter(
		"rp_prototype",
		"project = {:project} && id != {:id} && created < {:created}",
		"-created", // 按时间倒序
		1,          // 只要最近的一条
		0,
		map[string]any{
			"project": projectId,
			"id":      recordId,
			"created": currentRecord.GetDateTime("created").String(),
		},
	)

	if err == nil && len(prevRecords) > 0 {
		oldRecord := prevRecords[0]
		oldDestDir = resolvePhysicalDirectoryForPrototype(oldRecord)
		log.Printf("找到上一个版本，记录 ID: %s, 文件夹路径: %s", oldRecord.Id, oldDestDir)
	} else {
		log.Println("未找到该项目的上个版本记录，当前记录将作为初始版本。")
	}

	var diffJsonStr string
	if oldDestDir != "" && destDir != "" {
		if _, err := os.Stat(oldDestDir); err == nil {
			log.Println("开始跨纪录比对 HTML 纯文本差异...")
			diffJsonStr, _ = CompareAndSaveDiff(oldDestDir, destDir)
		} else {
			log.Printf("警告：虽然找到了旧记录，但其物理目录 %s 已不存在，无法对比。", oldDestDir)
		}
	}

	// 将计算出的 diff json 存库
	currentRecord.Set("diff_result", diffJsonStr)

	// --- 💡 核心修复：防止死循环 ---
	// 通过 Set("skip_diff_hook", true) 打个临时标记。
	// 在钩子上半部分拦截它，这样存入 diff 后就不会再次触发 Diff 计算了。
	currentRecord.Set("skip_diff_hook", true)
	return app.Save(currentRecord)
}

func tryGitCommitAndPush(sourceDir string, targetRelDir string, projectName string, versionTitle string) error {
	gitDir := filepath.Join(sourceDir, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		log.Printf("[Git] 源目录 %s 不是 Git 仓库，跳过 Git 提交", sourceDir)
		return nil
	}

	log.Printf("[Git] 准备提交并推送新版本到 Git 仓库: %s (目录: %s)", sourceDir, targetRelDir)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// 1. git add
	cmdAdd := exec.CommandContext(ctx, "git", "-C", sourceDir, "add", "-A", filepath.ToSlash(targetRelDir))
	cmdAdd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmdAdd.CombinedOutput(); err != nil {
		log.Printf("[Git] git add 失败: %v, 输出: %s", err, strings.TrimSpace(string(out)))
		return fmt.Errorf("git add failed: %w", err)
	}

	// 2. git commit
	commitMsg := fmt.Sprintf("docs(prototype): 上传 [%s] - [%s]", projectName, versionTitle)
	cmdCommit := exec.CommandContext(ctx, "git", "-C", sourceDir, "commit", "-m", commitMsg)
	cmdCommit.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmdCommit.CombinedOutput(); err != nil {
		outStr := strings.TrimSpace(string(out))
		if strings.Contains(outStr, "nothing to commit") || strings.Contains(outStr, "无文件要提交") || strings.Contains(outStr, "clean") {
			log.Printf("[Git] 没有新的文件变动需要提交: %s", outStr)
		} else {
			log.Printf("[Git] git commit 失败: %v, 输出: %s", err, outStr)
			return fmt.Errorf("git commit failed: %w", err)
		}
	} else {
		log.Printf("[Git] git commit 成功: %s", strings.TrimSpace(string(out)))
	}

	// 3. 测试阶段默认不推送到远程仓库（仅在显式配置 ENABLE_GIT_PUSH=true 时才推送）
	if os.Getenv("ENABLE_GIT_PUSH") != "true" && os.Getenv("AUTO_GIT_PUSH") != "true" {
		log.Printf("[Git] 当前处于测试阶段，已跳过远程 git push（本地修改与 Git Commit 已完成）")
		return nil
	}

	// 获取当前分支并 git push
	branchCmd := exec.CommandContext(ctx, "git", "-C", sourceDir, "rev-parse", "--abbrev-ref", "HEAD")
	branchCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	branchOut, err := branchCmd.Output()
	branch := "main"
	if err == nil && len(branchOut) > 0 {
		branch = strings.TrimSpace(string(branchOut))
	}

	cmdPush := exec.CommandContext(ctx, "git", "-C", sourceDir, "push", "origin", branch)
	cmdPush.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmdPush.CombinedOutput(); err != nil {
		log.Printf("[Git] git push origin %s 失败: %v, 输出: %s", branch, err, strings.TrimSpace(string(out)))
		return fmt.Errorf("git push failed: %w", err)
	} else {
		log.Printf("[Git] git push origin %s 成功: %s", branch, strings.TrimSpace(string(out)))
	}

	return nil
}

func sanitizePathComponent(name string) string {
	invalidChars := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	result := strings.TrimSpace(name)
	for _, char := range invalidChars {
		result = strings.ReplaceAll(result, char, "_")
	}
	result = strings.Trim(result, ". ")
	if result == "" {
		result = "unnamed"
	}
	return result
}

func tryGitPull(sourceDir string) {
	gitDir := filepath.Join(sourceDir, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		return
	}

	log.Printf("[Git] 检测到源目录为 Git 仓库，准备更新代码: %s", sourceDir)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// 1. git checkout . -f (清理未提交的修改，保证工作区干净)
	cmdCheckout := exec.CommandContext(ctx, "git", "-C", sourceDir, "checkout", ".", "-f")
	cmdCheckout.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmdCheckout.CombinedOutput(); err != nil {
		log.Printf("[Git] 执行 git checkout . -f 失败: %v, 输出: %s", err, strings.TrimSpace(string(out)))
	} else if len(out) > 0 {
		log.Printf("[Git] 执行 git checkout . -f 成功: %s", strings.TrimSpace(string(out)))
	}

	// 2. git pull
	cmdPull := exec.CommandContext(ctx, "git", "-C", sourceDir, "pull")
	cmdPull.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if out, err := cmdPull.CombinedOutput(); err != nil {
		log.Printf("[Git] 执行 git pull 失败: %v, 输出: %s", err, strings.TrimSpace(string(out)))
	} else {
		log.Printf("[Git] 执行 git pull 成功: %s", strings.TrimSpace(string(out)))
	}
}

func syncPrototypeDirectories(app core.App, creatorID string) (*syncSummary, error) {
	sourceDir := getEffectiveSourceDir()
	if sourceDir == "" {
		return nil, errSourceDirNotConfigured
	}

	absSourceDir, err := filepath.Abs(sourceDir)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(absSourceDir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("PROTOTYPE_SOURCE_DIR 不是目录")
	}

	// 如果源目录是 Git 仓库，先拉取最新代码并重置工作区
	tryGitPull(absSourceDir)

	log.Printf("[Scanner] 开始分析并载入原型路径，源目录: %s", absSourceDir)
	paths, skipped, err := discoverPrototypePaths(absSourceDir)
	if err != nil {
		log.Printf("[Scanner] 探索原型目录发生错误: %v", err)
		return nil, err
	}
	log.Printf("[Scanner] 探索完成。有效项目路径: %d 个, 忽略/跳过路径: %d 个", len(paths), len(skipped))

	mapping, err := loadScanMapping(app)
	if err != nil {
		log.Printf("[Scanner] 载入扫描 mapping 文件失败: %v", err)
		return nil, err
	}

	projectCollection, err := app.FindCollectionByNameOrId("rp_project")
	if err != nil {
		log.Printf("[Scanner] 获取 rp_project collection 失败: %v", err)
		return nil, err
	}

	prototypeCollection, err := app.FindCollectionByNameOrId("rp_prototype")
	if err != nil {
		log.Printf("[Scanner] 获取 rp_prototype collection 失败: %v", err)
		return nil, err
	}

	summary := &syncSummary{
		ScannedProjects: len(paths),
		SkippedPaths:    skipped,
	}

	for _, relPath := range paths {
		displayName := filepath.Base(relPath)
		log.Printf("[Scanner] ===> 开始同步项目 [%s]", relPath)
		projectRecord, createdProject, err := ensureProjectRecord(app, projectCollection, mapping, absSourceDir, relPath, displayName, creatorID)
		if err != nil {
			log.Printf("[Scanner] 同步项目记录失败 [%s]: %v", relPath, err)
			summary.SkippedPaths = append(summary.SkippedPaths, relPath+": [Project] "+err.Error())
			continue
		}
		if createdProject {
			summary.CreatedProjects++
			log.Printf("[Scanner] 项目记录新建成功 [%s] (ID: %s)", relPath, projectRecord.Id)
		} else {
			summary.UpdatedProjects++
			log.Printf("[Scanner] 项目记录更新成功 [%s] (ID: %s)", relPath, projectRecord.Id)
		}

		_, createdVersion, err := ensurePrototypeRecord(app, prototypeCollection, mapping, absSourceDir, relPath, projectRecord, creatorID)
		if err != nil {
			log.Printf("[Scanner] 同步版本记录失败 [%s]: %v", relPath, err)
			summary.SkippedPaths = append(summary.SkippedPaths, relPath+": [Version] "+err.Error())
			continue
		}
		if createdVersion {
			summary.CreatedVersions++
			log.Printf("[Scanner] 版本记录新建成功 [%s]", relPath)
		} else {
			summary.UpdatedVersions++
			log.Printf("[Scanner] 版本记录更新成功 [%s]", relPath)
		}

		summary.SyncedProjects++
	}

	// 收集当前同步成功的 Project ID 与 Version ID
	syncedProjectIDs := make(map[string]bool, len(paths))
	syncedVersionIDs := make(map[string]bool, len(paths))
	for _, projID := range mapping.Projects {
		if projID != "" {
			syncedProjectIDs[projID] = true
		}
	}
	for _, verID := range mapping.Versions {
		if verID != "" {
			syncedVersionIDs[verID] = true
		}
	}

	// 清理 mapping 中多余或已失效的路径键
	validPathsSet := make(map[string]bool, len(paths))
	for _, p := range paths {
		validPathsSet[p] = true
	}
	for relPath := range mapping.Projects {
		if !validPathsSet[relPath] {
			delete(mapping.Projects, relPath)
		}
	}
	for relPath := range mapping.Versions {
		if !validPathsSet[relPath] {
			delete(mapping.Versions, relPath)
		}
	}

	// 严格清理：数据库中所有属于 [AUTO_SOURCE] 自动扫描但未在本次同步列表中的孤立/重复项目和版本
	if allAutoProjects, err := app.FindRecordsByFilter("rp_project", "source_type = 'auto' || is_auto = true || description ~ {:prefix}", "", 0, 0, map[string]any{"prefix": autoSourcePrefix}); err == nil {
		for _, projRecord := range allAutoProjects {
			if !syncedProjectIDs[projRecord.Id] {
				log.Printf("[Scanner] 清理孤立/重复的自动扫描项目: %s (ID: %s)", projRecord.GetString("description"), projRecord.Id)
				if verRecords, err := app.FindRecordsByFilter("rp_prototype", "project = {:projID}", "", 0, 0, map[string]any{"projID": projRecord.Id}); err == nil {
					for _, vr := range verRecords {
						_ = app.Delete(vr)
					}
				}
				if err := app.Delete(projRecord); err == nil {
					summary.DeletedProjects++
				}
			}
		}
	}

	// 清理多余孤立的自动版本
	if allAutoVersions, err := app.FindRecordsByFilter("rp_prototype", "source_type = 'auto' || is_auto = true || remark ~ {:prefix}", "", 0, 0, map[string]any{"prefix": autoSourcePrefix}); err == nil {
		for _, verRecord := range allAutoVersions {
			if !syncedVersionIDs[verRecord.Id] {
				_ = app.Delete(verRecord)
			}
		}
	}

	if err := saveScanMapping(app, mapping); err != nil {
		log.Printf("[Scanner] 保存扫描 mapping 记录发生错误: %v", err)
		return nil, err
	}

	sort.Strings(summary.SkippedPaths)
	log.Printf("[Scanner] === 同步全部完成。扫描发现项目数: %d, 成功同步项目数: %d, 新增项目数: %d, 更新项目数: %d, 清理移除项目数: %d ===",
		summary.ScannedProjects, summary.SyncedProjects, summary.CreatedProjects, summary.UpdatedProjects, summary.DeletedProjects)

	return summary, nil
}

func discoverPrototypePaths(sourceDir string) ([]string, []string, error) {
	log.Printf("[Scanner] 开始多层级深度扫描源目录: %s", sourceDir)

	var paths []string
	var skipped []string

	scanDirRecursive(sourceDir, "", 0, 8, &paths, &skipped)

	timeCache := make(map[string]time.Time, len(paths))
	for _, p := range paths {
		timeCache[p] = resolveFolderTime(sourceDir, p)
	}

	sort.Slice(paths, func(i, j int) bool {
		timeI := timeCache[paths[i]]
		timeJ := timeCache[paths[j]]
		if timeI.Equal(timeJ) {
			return paths[i] < paths[j]
		}
		return timeI.After(timeJ)
	})

	log.Printf("[Scanner] 深度扫描完成。共发现有效项目路径: %d 个, 忽略/错误路径: %d 个", len(paths), len(skipped))
	return paths, skipped, nil
}

func scanDirRecursive(sourceDir string, currentRelPath string, depth int, maxDepth int, paths *[]string, skipped *[]string) {
	if depth > maxDepth {
		return
	}

	currentAbs := filepath.Join(sourceDir, currentRelPath)

	if currentRelPath != "" {
		baseName := filepath.Base(currentRelPath)
		if isHiddenName(baseName) || isAxureResourceDir(baseName) {
			return
		}

		isProto, err := isPrototypeDir(currentAbs)
		if err != nil {
			log.Printf("[Scanner] 检查目录失败 [%s]: %v", currentRelPath, err)
			*skipped = append(*skipped, currentRelPath+": "+err.Error())
			return
		}

		if isProto {
			log.Printf("[Scanner] [命中原型项目] 深度 %d: %s", depth, currentRelPath)
			*paths = append(*paths, filepath.ToSlash(currentRelPath))
			// 命中原型根目录后，不再向其内部子目录递归
			return
		}
	}

	entries, err := os.ReadDir(currentAbs)
	if err != nil {
		log.Printf("[Scanner] 读取目录失败 [%s]: %v", currentRelPath, err)
		if depth > 0 {
			*skipped = append(*skipped, currentRelPath+": "+err.Error())
		}
		return
	}

	for _, entry := range entries {
		if !isEntryDir(currentAbs, entry) || isHiddenName(entry.Name()) || isAxureResourceDir(entry.Name()) {
			continue
		}

		childRelPath := entry.Name()
		if currentRelPath != "" {
			childRelPath = filepath.Join(currentRelPath, entry.Name())
		}

		scanDirRecursive(sourceDir, childRelPath, depth+1, maxDepth, paths, skipped)
	}
}

func isAxureResourceDir(name string) bool {
	lower := strings.ToLower(name)
	return lower == "data" || lower == "files" || lower == "images" || lower == "plugins" || lower == "resources" || lower == "__macosx"
}

func isPrototypeDir(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, err
	}

	// 任何有效的原型项目根目录必须包含至少一个可访问的 HTML 文件
	hasHTML := false
	hasAxureAssetDir := false
	hasStandardEntry := false

	standardFiles := map[string]bool{
		"index.html":   true,
		"index.htm":    true,
		"start.html":   true,
		"app.html":     true,
		"default.html": true,
	}

	for _, entry := range entries {
		if isHiddenName(entry.Name()) {
			continue
		}
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".html") {
			hasHTML = true
			if standardFiles[strings.ToLower(entry.Name())] {
				hasStandardEntry = true
			}
		} else if isEntryDir(dir, entry) && isAxureResourceDir(entry.Name()) {
			hasAxureAssetDir = true
		}
	}

	// 如果目录下没有任何 HTML 文件，则绝对不是有效的原型（避免空目录/Git 残留空文件夹被误判）
	if !hasHTML {
		return false, nil
	}

	if hasStandardEntry {
		return true, nil
	}

	if fileExists(filepath.Join(dir, "data", "document.js")) ||
		fileExists(filepath.Join(dir, "data", "styles.css")) ||
		dirExists(filepath.Join(dir, "resources", "scripts", "axure")) ||
		dirExists(filepath.Join(dir, "resources", "scripts")) {
		return true, nil
	}

	return hasAxureAssetDir, nil
}

func resolvePrototypeEntryHTML(dir string) string {
	standardFiles := []string{"index.html", "start.html", "app.html", "index.htm", "default.html"}
	for _, name := range standardFiles {
		if fileExists(filepath.Join(dir, name)) {
			return name
		}
	}

	entries, err := os.ReadDir(dir)
	if err == nil {
		var htmlFiles []string
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".html") && !isHiddenName(entry.Name()) {
				htmlFiles = append(htmlFiles, entry.Name())
			}
		}
		if len(htmlFiles) > 0 {
			sort.Strings(htmlFiles)
			return htmlFiles[0]
		}
	}

	return "index.html"
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err == nil {
		return !info.IsDir()
	}
	return false
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	if err == nil {
		return info.IsDir()
	}
	return false
}

var (
	// 1. 包含分隔符的年月日: 2026年9月15日, 2026-09-15, 2026.9.5, 2026_09_15
	reFullDate = regexp.MustCompile(`(?i)(20\d{2})[-_./年\s](1[0-2]|0?[1-9])[-_./月\s](3[01]|[12]\d|0?[1-9])[日号\s]?`)

	// 2. 紧凑8位日期: 20260915
	reCompact8Date = regexp.MustCompile(`(?:^|[^\d])(20\d{2})(1[0-2]|0[1-9])(3[01]|[12]\d|0[1-9])(?:[^\d]|$)`)

	// 3. 年月格式: 2026年9月, 2026年10月, 2026-11, 2026.12, 2026_09
	reYearMonth = regexp.MustCompile(`(?i)(20\d{2})[-_./年\s](1[0-2]|0?[1-9])(?:月)?`)

	// 4. 紧凑6位年月: 202611
	reCompact6YearMonth = regexp.MustCompile(`(?:^|[^\d])(20\d{2})(1[0-2]|0[1-9])(?:[^\d]|$)`)

	// 5. 月日格式: 9月15日, 11-15, 12.15
	reMonthDay = regexp.MustCompile(`(?i)(?:^|[^v\d])(1[0-2]|0?[1-9])[-_./月\s](3[01]|[12]\d|0?[1-9])[日号\s]?`)

	// 6. 仅含日: 15日, 15号
	reDay = regexp.MustCompile(`(?:^|[^\d])(3[01]|[12]\d|0?[1-9])[日号]`)

	// 7. 仅含月: 1月, 10月, 11月, 12月
	reMonthOnly = regexp.MustCompile(`(?:^|[^\d])(1[0-2]|0?[1-9])月`)

	// 8. 仅含年: 2026年
	reYearOnly = regexp.MustCompile(`(?i)(20\d{2})年`)

	// 9. 年前/年以前: 2025年前, 2025年以前
	reYearBefore = regexp.MustCompile(`(?i)(20\d{2})年以?前`)
)

func resolveFolderTime(sourceDir string, relPath string) time.Time {
	// 获取 Git 提交时间（若无则获取文件修改时间）作为辅助参考
	var refTime time.Time
	if gitTime, ok := getGitCommitTime(sourceDir, relPath); ok && !gitTime.IsZero() {
		refTime = gitTime
	} else {
		projectDir := filepath.Join(sourceDir, filepath.FromSlash(relPath))
		refTime = getDirectoryModTime(projectDir)
	}

	return extractTimeFromPath(relPath, refTime)
}

func getGitCommitTime(sourceDir string, relPath string) (time.Time, bool) {
	gitDir := filepath.Join(sourceDir, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		return time.Time{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "-C", sourceDir, "log", "-1", "--format=%ct", "--", filepath.ToSlash(relPath))
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.Output()
	if err != nil {
		return time.Time{}, false
	}

	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return time.Time{}, false
	}

	sec, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, false
	}

	return time.Unix(sec, 0), true
}

func extractTimeFromPath(relPath string, fallback time.Time) time.Time {
	normPath := filepath.ToSlash(relPath)
	var year, month, day int

	// 0. 特殊处理 "2025年前", "2025年以前" 等历史归档前缀
	if m := reYearBefore.FindStringSubmatch(normPath); len(m) == 2 {
		y, _ := strconv.Atoi(m[1])
		year = y - 1 // 2024
		month = 12
		day = 31

		// 检查归档目录内部是否还有子年份/月份
		subPath := normPath[strings.Index(normPath, m[0])+len(m[0]):]
		if subM := reYearMonth.FindStringSubmatch(subPath); len(subM) == 3 {
			subY, _ := strconv.Atoi(subM[1])
			if subY <= year {
				year = subY
			}
			month, _ = strconv.Atoi(subM[2])
			day = 1
		} else if subM := reMonthOnly.FindStringSubmatch(subPath); len(subM) == 2 {
			month, _ = strconv.Atoi(subM[1])
			day = 1
		}
	} else if m := reFullDate.FindStringSubmatch(normPath); len(m) == 4 {
		year, _ = strconv.Atoi(m[1])
		month, _ = strconv.Atoi(m[2])
		day, _ = strconv.Atoi(m[3])
	} else if m := reCompact8Date.FindStringSubmatch(normPath); len(m) == 4 {
		year, _ = strconv.Atoi(m[1])
		month, _ = strconv.Atoi(m[2])
		day, _ = strconv.Atoi(m[3])
	} else {
		// 匹配年月
		if m := reYearMonth.FindStringSubmatch(normPath); len(m) == 3 {
			year, _ = strconv.Atoi(m[1])
			month, _ = strconv.Atoi(m[2])
		} else if m := reCompact6YearMonth.FindStringSubmatch(normPath); len(m) == 3 {
			year, _ = strconv.Atoi(m[1])
			month, _ = strconv.Atoi(m[2])
		} else if m := reYearOnly.FindStringSubmatch(normPath); len(m) == 2 {
			year, _ = strconv.Atoi(m[1])
		}

		// 检查是否有更具体的月日或日
		if m := reMonthDay.FindStringSubmatch(normPath); len(m) == 3 {
			if month == 0 {
				month, _ = strconv.Atoi(m[1])
			}
			day, _ = strconv.Atoi(m[2])
		} else if m := reDay.FindStringSubmatch(normPath); len(m) == 2 {
			day, _ = strconv.Atoi(m[1])
		} else if month == 0 {
			if m := reMonthOnly.FindStringSubmatch(normPath); len(m) == 2 {
				month, _ = strconv.Atoi(m[1])
			}
		}
	}

	// 如果路径中没有任何时间特征，使用 Git 提交时间或文件系统修改时间
	if year == 0 && month == 0 && day == 0 {
		if fallback.IsZero() {
			return time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
		}
		return fallback
	}

	// 补充缺失的年份或月份
	if year == 0 {
		if !fallback.IsZero() && fallback.Year() < 2026 {
			year = fallback.Year()
		} else {
			year = 2024
		}
	}

	if month == 0 {
		month = 1
	}

	if day == 0 {
		if !fallback.IsZero() && fallback.Year() == year && int(fallback.Month()) == month {
			day = fallback.Day()
		} else {
			day = 1
		}
	}

	var hour, min, sec, nsec int
	if !fallback.IsZero() {
		// 无论 fallback 处于哪个月，均保留时分秒与纳秒，确保同月份下的项目能依据最新修改时间精准排序
		hour, min, sec = fallback.Hour(), fallback.Minute(), fallback.Second()
		nsec = fallback.Nanosecond()
	}

	return time.Date(year, time.Month(month), day, hour, min, sec, nsec, time.UTC)
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func getDirectoryModTime(dirPath string) time.Time {
	info, err := os.Stat(dirPath)
	if err != nil {
		return time.Now()
	}
	latest := info.ModTime()

	_ = filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if isHiddenName(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entryInfo, err := d.Info(); err == nil && entryInfo.ModTime().After(latest) {
			latest = entryInfo.ModTime()
		}
		return nil
	})
	return latest
}

func ensureProjectRecord(app core.App, collection *core.Collection, mapping *scanMapping, sourceDir string, relPath string, displayName string, creatorID string) (*core.Record, bool, error) {
	if id := mapping.Projects[relPath]; id != "" {
		record, err := app.FindFirstRecordByFilter(collection, "id = {:id}", map[string]any{"id": id})
		if err == nil {
			applyProjectFields(record, sourceDir, relPath, displayName, creatorID)
			return record, false, app.Save(record)
		}
	}

	desc := autoDescription(relPath)
	if record, err := app.FindFirstRecordByFilter(collection, "description = {:desc}", map[string]any{"desc": desc}); err == nil {
		applyProjectFields(record, sourceDir, relPath, displayName, creatorID)
		mapping.Projects[relPath] = record.Id
		return record, false, app.Save(record)
	}

	record := core.NewRecord(collection)
	applyProjectFields(record, sourceDir, relPath, displayName, creatorID)
	if err := app.Save(record); err != nil {
		return nil, false, err
	}

	mapping.Projects[relPath] = record.Id
	return record, true, nil
}

func ensurePrototypeRecord(app core.App, collection *core.Collection, mapping *scanMapping, sourceDir string, relPath string, projectRecord *core.Record, creatorID string) (*core.Record, bool, error) {
	if id := mapping.Versions[relPath]; id != "" {
		record, err := app.FindFirstRecordByFilter(collection, "id = {:id}", map[string]any{"id": id})
		if err == nil {
			applyPrototypeFields(record, sourceDir, relPath, projectRecord.Id, creatorID)
			return record, false, app.Save(record)
		}
	}

	record := core.NewRecord(collection)
	applyPrototypeFields(record, sourceDir, relPath, projectRecord.Id, creatorID)
	if err := app.Save(record); err != nil {
		return nil, false, err
	}

	mapping.Versions[relPath] = record.Id
	return record, true, nil
}

func applyProjectFields(record *core.Record, sourceDir string, relPath string, displayName string, creatorID string) {
	setFieldIfExists(record, "name", displayName)
	setFieldIfExists(record, "description", autoDescription(relPath))
	setFieldIfExists(record, "creator", creatorID)
	setFieldIfExists(record, "source_type", "auto")
	setFieldIfExists(record, "is_auto", true)

	folderTime := resolveFolderTime(sourceDir, relPath)
	setFieldIfExists(record, "folder_time", folderTime)

	coverFile, err := resolveProjectCoverFile(sourceDir, relPath)
	if err != nil {
		log.Printf("解析项目封面失败 [%s]: %v", relPath, err)
		return
	}
	if coverFile != nil {
		setFieldIfExists(record, "cover", coverFile)
	} else if strings.HasSuffix(strings.ToLower(record.GetString("cover")), ".svg") {
		setFieldIfExists(record, "cover", nil)
	}
}

func applyPrototypeFields(record *core.Record, sourceDir string, relPath string, projectID string, creatorID string) {
	setFieldIfExists(record, "project", projectID)
	setFieldIfExists(record, "title", autoVersionTitle)
	setFieldIfExists(record, "remark", autoDescription(relPath))
	setFieldIfExists(record, "status", "approved")
	setFieldIfExists(record, "source_type", "auto")
	setFieldIfExists(record, "is_auto", true)

	entryFile := resolvePrototypeEntryHTML(filepath.Join(sourceDir, filepath.FromSlash(relPath)))
	setFieldIfExists(record, "url", "/linked-projects/"+filepath.ToSlash(relPath)+"/"+entryFile)
	setFieldIfExists(record, "creator", creatorID)
	setFieldIfExists(record, "skip_diff_hook", true)
}

func autoDescription(relPath string) string {
	return autoSourcePrefix + " " + filepath.ToSlash(relPath)
}

func isAutoPrototypeRecord(record *core.Record) bool {
	return strings.HasPrefix(record.GetString("remark"), autoSourcePrefix)
}

func setFieldIfExists(record *core.Record, name string, value any) {
	if record.Collection().Fields.GetByName(name) != nil {
		record.Set(name, value)
	}
}

func resolveProjectCoverFile(sourceDir string, relPath string) (*filesystem.File, error) {
	projectDir := filepath.Join(sourceDir, filepath.FromSlash(relPath))
	imagesDir := filepath.Join(projectDir, "images")

	info, err := os.Stat(imagesDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, nil
	}

	entries, err := os.ReadDir(imagesDir)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if !isEntryDir(imagesDir, entry) || isHiddenName(entry.Name()) {
			continue
		}

		imagePath, err := findFirstImagePath(filepath.Join(imagesDir, entry.Name()))
		if err != nil {
			return nil, err
		}
		if imagePath == "" {
			continue
		}

		return filesystem.NewFileFromPath(imagePath)
	}

	for _, entry := range entries {
		if isEntryDir(imagesDir, entry) || isHiddenName(entry.Name()) {
			continue
		}
		if !isSupportedProjectImage(entry.Name()) {
			continue
		}

		return filesystem.NewFileFromPath(filepath.Join(imagesDir, entry.Name()))
	}

	return nil, nil
}

func findFirstImagePath(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if isEntryDir(dir, entry) || isHiddenName(entry.Name()) {
			continue
		}
		if isSupportedProjectImage(entry.Name()) {
			return filepath.Join(dir, entry.Name()), nil
		}
	}

	for _, entry := range entries {
		if !isEntryDir(dir, entry) || isHiddenName(entry.Name()) {
			continue
		}

		imagePath, err := findFirstImagePath(filepath.Join(dir, entry.Name()))
		if err != nil {
			return "", err
		}
		if imagePath != "" {
			return imagePath, nil
		}
	}

	return "", nil
}

func isRasterImage(ext string) bool {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".ico":
		return true
	default:
		return false
	}
}

func isSupportedProjectImage(name string) bool {
	return isRasterImage(filepath.Ext(name))
}

func isHiddenName(name string) bool {
	return strings.HasPrefix(name, ".")
}

func isEntryDir(parentDir string, entry fs.DirEntry) bool {
	if entry.IsDir() {
		return true
	}
	if entry.Type()&os.ModeSymlink != 0 {
		info, err := os.Stat(filepath.Join(parentDir, entry.Name()))
		if err == nil {
			return info.IsDir()
		}
	}
	return false
}

func ensureSafeLinkedProjectPath(path string) error {
	cleaned := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(path, "/")))
	if cleaned == "." || cleaned == "" {
		return nil
	}
	if strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return errors.New("path traversal is not allowed")
	}
	return nil
}

func shouldServeSPAIndex(requestPath string) bool {
	cleaned := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(requestPath, "/")))
	if cleaned == "." || cleaned == "" {
		return true
	}

	if strings.HasPrefix(cleaned, "projects/") {
		return false
	}

	fullPath := filepath.Join("pb_public", filepath.FromSlash(cleaned))
	if info, err := os.Stat(fullPath); err == nil {
		return info.IsDir()
	}

	return filepath.Ext(cleaned) == ""
}

// precompressedExts 里的格式本身已经是压缩过的，再走一遍 gzip 只会白费 CPU，体积几乎不变。
var precompressedExts = map[string]bool{
	".png":   true,
	".jpg":   true,
	".jpeg":  true,
	".gif":   true,
	".webp":  true,
	".avif":  true,
	".mp4":   true,
	".webm":  true,
	".mp3":   true,
	".woff":  true,
	".woff2": true,
	".zip":   true,
	".gz":    true,
	".br":    true,
	".pdf":   true,
}

func isPrecompressedPath(requestPath string) bool {
	return precompressedExts[strings.ToLower(filepath.Ext(requestPath))]
}

func loadScanMapping(app core.App) (*scanMapping, error) {
	path := filepath.Join(app.DataDir(), mappingFileName)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &scanMapping{
				Projects: map[string]string{},
				Versions: map[string]string{},
			}, nil
		}
		return nil, err
	}

	var mapping scanMapping
	if err := json.Unmarshal(data, &mapping); err != nil {
		return nil, err
	}

	if mapping.Projects == nil {
		mapping.Projects = map[string]string{}
	}
	if mapping.Versions == nil {
		mapping.Versions = map[string]string{}
	}

	return &mapping, nil
}

func saveScanMapping(app core.App, mapping *scanMapping) error {
	data, err := json.MarshalIndent(mapping, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(app.DataDir(), os.ModePerm); err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(app.DataDir(), mappingFileName), data, 0o644)
}

func resolveCreatorID(app core.App, authRecord *core.Record) (string, error) {
	if authRecord != nil && authRecord.Collection().Name == "users" {
		return authRecord.Id, nil
	}

	email := strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_EMAIL"))
	if email == "" {
		email = defaultCreatorEmail
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return "", err
	}

	user, err := app.FindAuthRecordByEmail(usersCollection, email)
	if err != nil {
		return "", err
	}

	return user.Id, nil
}

// 解压函数：增加对 GBK 等非 UTF-8 编码文件名的支持，解决 macOS 下中文文件名的 illegal byte sequence 错误
func unzip(src string, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		// --- 💡 核心修复：处理中文乱码或非法字节序列 ---
		fileName := decodeZipName(f.Name)
		fpath := filepath.Join(dest, fileName)

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return err
		}
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.FileInfo().Mode())
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}
		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// 尝试将非 UTF-8 的 zip 文件名转为 UTF-8 (应对 Windows 默认打包的 GBK 中文名)
func decodeZipName(name string) string {
	if utf8.ValidString(name) {
		return name
	}
	// 如果不是合法的 UTF-8，尝试用 GB18030 / GBK 进行解码
	decoder := simplifiedchinese.GB18030.NewDecoder()
	decoded, err := decoder.String(name)
	if err == nil {
		return decoded
	}
	// 解析失败则返回原本的值
	return name
}
