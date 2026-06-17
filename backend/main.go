package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	_ "awesomeProject/migrations"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const (
	autoVersionTitle = "当前版本"
	autoSourcePrefix = "[AUTO_SOURCE]"
	mappingFileName = "prototype_scan_mapping.json"
	defaultCreatorEmail = "admin@example.com"
)

type scanMapping struct {
	Projects map[string]string `json:"projects"`
	Versions map[string]string `json:"versions"`
}

type syncSummary struct {
	ScannedProjects int      `json:"scanned_projects"`
	CreatedProjects int      `json:"created_projects"`
	UpdatedProjects int      `json:"updated_projects"`
	CreatedVersions int      `json:"created_versions"`
	UpdatedVersions int      `json:"updated_versions"`
	SkippedPaths    []string `json:"skipped_paths"`
}

var errSourceDirNotConfigured = errors.New("未配置 PROTOTYPE_SOURCE_DIR，无法扫描原型目录")

func main() {
	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: true,
		Dir:         "migrations",
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		staticHandler := apis.Static(os.DirFS("./pb_public"), false)
		sourceDir := strings.TrimSpace(os.Getenv("PROTOTYPE_SOURCE_DIR"))

		if sourceDir != "" {
			se.Router.GET("/linked-projects/{path...}", func(e *core.RequestEvent) error {
				if err := ensureSafeLinkedProjectPath(e.Request.PathValue(apis.StaticWildcardParam)); err != nil {
					return e.BadRequestError("非法的预览路径", err)
				}

				e.Response.Header().Del("X-Frame-Options")
				e.Response.Header().Set("Content-Security-Policy", "frame-ancestors *")

				return apis.Static(os.DirFS(sourceDir), false)(e)
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

		destDir := filepath.Join("pb_public", "projects", recordId)

		os.MkdirAll(destDir, os.ModePerm)
		log.Println("准备解压到文件夹:", destDir)

		if err := unzip(zipPath, destDir); err != nil {
			log.Println("解压失败:", err)
			return nil
		}
		log.Println("解压成功！")

		// 5. 动态寻找 index.html
		foundIndexPath := ""
		filepath.Walk(destDir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || strings.ToLower(info.Name()) != "index.html" {
				return nil
			}
			relPath, _ := filepath.Rel("pb_public", path)
			foundIndexPath = "/" + filepath.ToSlash(relPath)
			return filepath.SkipAll
		})

		if foundIndexPath == "" {
			foundIndexPath = "/projects/" + recordId + "/index.html"
		}

		if e.Record.GetString("url") != foundIndexPath {
			e.Record.Set("url", foundIndexPath)
			e.Record.Set("skip_diff_hook", true)
			if err := e.App.Save(e.Record); err != nil {
				log.Println("更新 url 字段失败:", err)
			} else {
				log.Println("更新 url 字段成功:", foundIndexPath)
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

// recalculateDiffForRecord : 辅助函数：负责为传入的 currentRecord 寻找其历史前任，并计算和保存 Diff
func recalculateDiffForRecord(app core.App, currentRecord *core.Record) error {
	projectId := currentRecord.GetString("project")
	if projectId == "" {
		return nil
	}

	recordId := currentRecord.Id
	destDir := filepath.Join("pb_public", "projects", recordId)
	var oldDestDir string

	log.Printf("所属项目 ID: %s，正在为 %s 查找历史版本...", projectId, recordId)

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
		oldDestDir = filepath.Join("pb_public", "projects", oldRecord.Id)
		log.Printf("找到上一个版本，记录 ID: %s, 文件夹路径: %s", oldRecord.Id, oldDestDir)
	} else {
		log.Println("未找到该项目的上个版本记录，当前记录将作为初始版本。")
	}

	var diffJsonStr string
	if oldDestDir != "" {
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

func syncPrototypeDirectories(app core.App, creatorID string) (*syncSummary, error) {
	sourceDir := strings.TrimSpace(os.Getenv("PROTOTYPE_SOURCE_DIR"))
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

	paths, skipped, err := discoverPrototypePaths(absSourceDir)
	if err != nil {
		return nil, err
	}

	mapping, err := loadScanMapping(app)
	if err != nil {
		return nil, err
	}

	projectCollection, err := app.FindCollectionByNameOrId("rp_project")
	if err != nil {
		return nil, err
	}

	prototypeCollection, err := app.FindCollectionByNameOrId("rp_prototype")
	if err != nil {
		return nil, err
	}

	summary := &syncSummary{
		ScannedProjects: len(paths),
		SkippedPaths:    skipped,
	}

	for _, relPath := range paths {
		displayName := filepath.Base(relPath)
		projectRecord, createdProject, err := ensureProjectRecord(app, projectCollection, mapping, relPath, displayName, creatorID)
		if err != nil {
			summary.SkippedPaths = append(summary.SkippedPaths, relPath+": "+err.Error())
			continue
		}
		if createdProject {
			summary.CreatedProjects++
		} else {
			summary.UpdatedProjects++
		}

		_, createdVersion, err := ensurePrototypeRecord(app, prototypeCollection, mapping, relPath, projectRecord, creatorID)
		if err != nil {
			summary.SkippedPaths = append(summary.SkippedPaths, relPath+": "+err.Error())
			continue
		}
		if createdVersion {
			summary.CreatedVersions++
		} else {
			summary.UpdatedVersions++
		}
	}

	if err := saveScanMapping(app, mapping); err != nil {
		return nil, err
	}

	sort.Strings(summary.SkippedPaths)

	return summary, nil
}

func discoverPrototypePaths(sourceDir string) ([]string, []string, error) {
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return nil, nil, err
	}

	var paths []string
	var skipped []string

	for _, entry := range entries {
		if !entry.IsDir() || isHiddenName(entry.Name()) {
			continue
		}

		topLevelPath := entry.Name()
		topLevelAbs := filepath.Join(sourceDir, topLevelPath)
		hasIndex, err := containsIndexHTML(topLevelAbs)
		if err != nil {
			skipped = append(skipped, topLevelPath+": "+err.Error())
			continue
		}
		if hasIndex {
			paths = append(paths, topLevelPath)
			continue
		}

		childEntries, err := os.ReadDir(topLevelAbs)
		if err != nil {
			skipped = append(skipped, topLevelPath+": "+err.Error())
			continue
		}

		for _, child := range childEntries {
			if !child.IsDir() || isHiddenName(child.Name()) {
				continue
			}

			childPath := filepath.Join(topLevelPath, child.Name())
			childAbs := filepath.Join(sourceDir, childPath)
			hasIndex, err := containsIndexHTML(childAbs)
			if err != nil {
				skipped = append(skipped, childPath+": "+err.Error())
				continue
			}
			if hasIndex {
				paths = append(paths, filepath.ToSlash(childPath))
			}
		}
	}

	sort.Strings(paths)
	return paths, skipped, nil
}

func ensureProjectRecord(app core.App, collection *core.Collection, mapping *scanMapping, relPath string, displayName string, creatorID string) (*core.Record, bool, error) {
	if id := mapping.Projects[relPath]; id != "" {
		record, err := app.FindFirstRecordByFilter(collection, "id = {:id}", map[string]any{"id": id})
		if err == nil {
			applyProjectFields(record, relPath, displayName, creatorID)
			return record, false, app.Save(record)
		}
	}

	record := core.NewRecord(collection)
	applyProjectFields(record, relPath, displayName, creatorID)
	if err := app.Save(record); err != nil {
		return nil, false, err
	}

	mapping.Projects[relPath] = record.Id
	return record, true, nil
}

func ensurePrototypeRecord(app core.App, collection *core.Collection, mapping *scanMapping, relPath string, projectRecord *core.Record, creatorID string) (*core.Record, bool, error) {
	if id := mapping.Versions[relPath]; id != "" {
		record, err := app.FindFirstRecordByFilter(collection, "id = {:id}", map[string]any{"id": id})
		if err == nil {
			applyPrototypeFields(record, relPath, projectRecord.Id, creatorID)
			return record, false, app.Save(record)
		}
	}

	record := core.NewRecord(collection)
	applyPrototypeFields(record, relPath, projectRecord.Id, creatorID)
	if err := app.Save(record); err != nil {
		return nil, false, err
	}

	mapping.Versions[relPath] = record.Id
	return record, true, nil
}

func applyProjectFields(record *core.Record, relPath string, displayName string, creatorID string) {
	setFieldIfExists(record, "name", displayName)
	setFieldIfExists(record, "description", autoDescription(relPath))
	setFieldIfExists(record, "creator", creatorID)
}

func applyPrototypeFields(record *core.Record, relPath string, projectID string, creatorID string) {
	setFieldIfExists(record, "project", projectID)
	setFieldIfExists(record, "title", autoVersionTitle)
	setFieldIfExists(record, "remark", autoDescription(relPath))
	setFieldIfExists(record, "status", "approved")
	setFieldIfExists(record, "url", "/linked-projects/"+filepath.ToSlash(relPath)+"/index.html")
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

func containsIndexHTML(dir string) (bool, error) {
	info, err := os.Stat(filepath.Join(dir, "index.html"))
	if err == nil {
		return !info.IsDir(), nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func isHiddenName(name string) bool {
	return strings.HasPrefix(name, ".")
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
