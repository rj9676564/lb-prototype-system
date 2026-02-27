package main

import (
	"archive/zip"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis" // 新增 apis 导入
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	app := pocketbase.New()

	// 添加静态文件服务：将 pb_public 下的文件挂载到 URL 根目录下
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		staticHandler := apis.Static(os.DirFS("./pb_public"), false)

		// 注册一个通用的静态文件处理路由，并在此移除 X-Frame-Options
		se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
			// 移除 X-Frame-Options 以允许 iframe 嵌入
			e.Response.Header().Del("X-Frame-Options")
			// 也增加 CSP 支持（如果是为了现代浏览器）
			e.Response.Header().Set("Content-Security-Policy", "frame-ancestors *")
			
			return staticHandler(e)
		})
		return se.Next()
	})

	// 为确保无论是新建还是修改都能被捕获到，我们同时监听 Create 和 Update
	hookFunc := func(e *core.RecordEvent) error {
		// 为了排查你的表名是不是填错了，我们先把所有的表都打印出来
		log.Printf("===> 捕获到表 [%s] 的变动事件", e.Record.Collection().Name)

		// 如果不是我们期望的表，就直接跳过
		if e.Record.Collection().Name != "rp_prototype" {
			return nil
		}

		// --- 💡 防死循环拦截 ---
		if e.Record.GetBool("skip_diff_hook") {
			// 一旦识别到是我们后台重新塞进去保存的，立刻返回，不要走后面的解压缩和差异对比了
			// 并且马上清理掉这个标记，免得后续别人正当修改的时候也不生效
			e.Record.Set("skip_diff_hook", false)
			log.Println("------ [防死循环] 拦截到系统后台更新 Diff 的保存，已直接跳过 ------")
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

		// 1. 获取文件路径
		dataDir := e.App.DataDir()
		collectionId := e.Record.Collection().Id
		recordId := e.Record.Id
		zipPath := filepath.Join(dataDir, "storage", collectionId, recordId, fileField)
		log.Println("目标 ZIP 路径:", zipPath)

		// 检查ZIP是否存在
		if _, err := os.Stat(zipPath); os.IsNotExist(err) {
			log.Println("错误：找不到 ZIP 文件路径 ->", zipPath)
			return nil
		}

		// 2. 设定解压目标 (pb_public/projects/ID)
		destDir := filepath.Join("pb_public", "projects", recordId)

		os.MkdirAll(destDir, os.ModePerm)
		log.Println("准备解压到文件夹:", destDir)

		// 4. 执行解压 (保留在主线程，确保用户收到回复时文件已经就绪)
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

		// 为了防止 e.App.Save 触发无限循环，我们要判断 url 是否有修改
		// 如果修改了，我们使用带 skip 标记的方式保存
		if e.Record.GetString("url") != foundIndexPath {
			e.Record.Set("url", foundIndexPath)
			e.Record.Set("skip_diff_hook", true) // 告诉下面的触发钩子这次不要管
			if err := e.App.Save(e.Record); err != nil {
				log.Println("更新 url 字段失败:", err)
			} else {
				log.Println("更新 url 字段成功:", foundIndexPath)
			}
		}

		// --- 💡 核心改进：执行异步处理 ---
		// 开启一个后台协程处理耗时的 Diff 计算，不阻塞当前的 HTTP 返回
		go func(app core.App, record *core.Record) {
			log.Println("[后台任务] 开始异步处理流程...")
			if err := recalculateDiffForRecord(app, record); err != nil {
				log.Println("[后台任务] 最终保存记录失败:", err)
			} else {
				log.Println("[后台任务] 所有后台处理已完成。")
			}
		}(e.App, e.Record)

		return nil // 钩子执行完毕，立即释放线程，用户端会立即看到“保存成功”
	}

	app.OnRecordAfterCreateSuccess().BindFunc(hookFunc)
	app.OnRecordAfterUpdateSuccess().BindFunc(hookFunc)

	// --- 💡 核心新增：监听记录删除事件，清理文件夹并链式更新后续记录 ---
	app.OnRecordAfterDeleteSuccess().BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Collection().Name != "rp_prototype" {
			return nil
		}

		projectId := e.Record.GetString("project")
		recordId := e.Record.Id

		// 1. 物理删除已删记录的文件目录
		os.RemoveAll(filepath.Join("pb_public", "projects", recordId))
		log.Printf("已清理被删除记录 (%s) 的文件夹", recordId)

		if projectId == "" {
			return nil
		}

		// 2. 查找是否有下一个受影响的版本 (C)
		// 条件：同项目，且创建时间在这条刚刚删除的记录之后的第一条新记录
		nextRecords, err := e.App.FindRecordsByFilter(
			"rp_prototype",
			"project = {:project} && id != {:id} && created > {:created}",
			"+created", // 按时间升序，取紧接着的下一个
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
			// 异步触发下一个版本的差异重算计算 (由于是在别的线程，不阻塞删除流程)
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

// 解压函数保持不变
func unzip(src string, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fpath := filepath.Join(dest, f.Name)
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
