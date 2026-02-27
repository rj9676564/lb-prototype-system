package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/sergi/go-diff/diffmatchpatch"
	"golang.org/x/net/html"
)

// DiffResult 表示整个文件差异的结果
type DiffResult struct {
	AddedFiles    []string   `json:"added_files"`
	RemovedFiles  []string   `json:"removed_files"`
	ModifiedFiles []FileDiff `json:"modified_files"`
}

// FileDiff 表示单个文件的内容变化
type FileDiff struct {
	FilePath string       `json:"file_path"`
	Changes  []ChangeItem `json:"changes"`
}

// ChangeItem 记录一段内容的变动：变更前后的完整块内容
type ChangeItem struct {
	Type   string `json:"type"`   // "update" (修改), "add" (新增内容), "delete" (删除内容)
	Before string `json:"before"` // 变动前的内容
	After  string `json:"after"`  // 变动后的内容
}

// CompareProtoDirectories 对比旧版(oldDir)和新版(newDir)解压目录的结构和内容，返回差异结果 JSON 对象
func CompareProtoDirectories(oldDir, newDir string) (*DiffResult, error) {
	result := &DiffResult{
		AddedFiles:    []string{},
		RemovedFiles:  []string{},
		ModifiedFiles: []FileDiff{},
	}

	// 1. 获取新老目录下的所有 HTML 文件及其绝对路径
	oldFiles, err := scanHTMLFiles(oldDir)
	if err != nil {
		return nil, err
	}
	newFiles, err := scanHTMLFiles(newDir)
	if err != nil {
		return nil, err
	}

	dmp := diffmatchpatch.New()
	
	// 2. 遍历新文件夹查找新增和修改
	for relPath, newAbsPath := range newFiles {
		oldAbsPath, exists := oldFiles[relPath]
		if !exists {
			result.AddedFiles = append(result.AddedFiles, relPath)
			continue
		}

		// 老版本也有，开始提取纯文字对比
		oldText, _ := extractTextFromHTML(oldAbsPath)
		newText, _ := extractTextFromHTML(newAbsPath)

		if oldText != newText {
			// --- 💡 核心改进：执行行级对比 (Line-level Diff) ---
			// 将文本转换为以行为单位的“伪字符”进行对比，确保差异结果以整行为最小单位
			a, b, c := dmp.DiffLinesToChars(oldText, newText)
			diffs := dmp.DiffMain(a, b, false)
			diffs = dmp.DiffCharsToLines(diffs, c)
			diffs = dmp.DiffCleanupSemantic(diffs)

			fileDiff := FileDiff{
				FilePath: relPath,
				Changes:  []ChangeItem{},
			}
			
			i := 0
			for i < len(diffs) {
				d := diffs[i]
				if d.Type == diffmatchpatch.DiffEqual {
					i++
					continue
				}

				item := ChangeItem{}
				
				// 探测是 Delete 还是 Insert
				if d.Type == diffmatchpatch.DiffDelete {
					item.Before = strings.TrimSpace(d.Text)
					item.Type = "delete"
					
					// 下一个是 Insert 吗？是的话就变成 Update
					if i+1 < len(diffs) && diffs[i+1].Type == diffmatchpatch.DiffInsert {
						item.After = strings.TrimSpace(diffs[i+1].Text)
						item.Type = "update"
						i += 2
					} else {
						i++
					}
				} else if d.Type == diffmatchpatch.DiffInsert {
					item.After = strings.TrimSpace(d.Text)
					item.Type = "add"
					
					// 下一个是 Delete 吗？是的话也变成 Update
					if i+1 < len(diffs) && diffs[i+1].Type == diffmatchpatch.DiffDelete {
						item.Before = strings.TrimSpace(diffs[i+1].Text)
						item.Type = "update"
						i += 2
					} else {
						i++
					}
				}
				
				if item.Before != "" || item.After != "" {
					fileDiff.Changes = append(fileDiff.Changes, item)
				}
			}
			
			if len(fileDiff.Changes) > 0 {
				result.ModifiedFiles = append(result.ModifiedFiles, fileDiff)
			}
		}
		
		delete(oldFiles, relPath) 
	}

	// 3. 剩下还在老 map 里的，全是被删除的文件
	for relPath := range oldFiles {
		result.RemovedFiles = append(result.RemovedFiles, relPath)
	}

	return result, nil
}

// scanHTMLFiles 扫描目录下所有文件，过滤出 HTML，返回 key(标准化的相对路径) -> value(绝对路径) 构成的 Map
func scanHTMLFiles(baseDir string) (map[string]string, error) {
	files := make(map[string]string)

	// 1. 寻找“锚点”目录：即包含 index.html 的最浅层目录
	// 这样可以解决有的 ZIP 压了一层文件夹，有的没压的问题，让两次对比的相对路径能对齐
	anchorDir := baseDir
	minDepth := 999
	filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if strings.ToLower(info.Name()) == "index.html" {
			rel, _ := filepath.Rel(baseDir, path)
			depth := strings.Count(rel, string(os.PathSeparator))
			if depth < minDepth {
				minDepth = depth
				anchorDir = filepath.Dir(path)
			}
		}
		return nil
	})

	// 2. 遍历并过滤文件
	filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}

		// --- 💡 核心改进：根据用户反馈增加过滤逻辑 ---
		
		// A. 过滤掉以 . 开头的文件（如 .DS_Store, ._xxx.html 等 macOS 产生的干扰文件）
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		// B. 过滤掉 resources 目录下的任何内容（通常是框架、插件文件，非业务原型内容）
		relToRoot, _ := filepath.Rel(baseDir, path)
		standardRelToRoot := filepath.ToSlash(relToRoot)
		if strings.Contains(standardRelToRoot, "/resources/") || strings.HasPrefix(standardRelToRoot, "resources/") {
			return nil
		}

		// C. 仅对比 HTML 文件
		lowerName := strings.ToLower(info.Name())
		if !strings.HasSuffix(lowerName, ".html") && !strings.HasSuffix(lowerName, ".htm") {
			return nil
		}

		// D. 计算相对于“锚点”目录的路径，确保两次对比的版本即使文件夹层级不同也能“对齐”
		relPath, _ := filepath.Rel(anchorDir, path)
		// 如果文件在锚点目录之外（说明不是原型主体部分），则忽略
		if strings.HasPrefix(relPath, "..") {
			return nil
		}

		relPath = filepath.ToSlash(relPath)
		files[relPath] = path
		return nil
	})

	return files, nil
}

// extractTextFromHTML 从 HTML 文件里解析出可视纯文本（过滤掉 script/style 和标签）
func extractTextFromHTML(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	doc, err := html.Parse(file)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	var f func(*html.Node)
	f = func(n *html.Node) {
		if n.Type == html.TextNode {
			// 收集文字
			text := strings.TrimSpace(n.Data)
			if text != "" {
				sb.WriteString(text)
				sb.WriteString("\n")
			}
		}
		
		// 递归遍历，但跳过 <script> 和 <style> 标签
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && (c.Data == "script" || c.Data == "style" || c.Data == "head") {
				continue
			}
			f(c)
		}
	}
	f(doc)

	return sb.String(), nil
}

// CompareAndSaveDiff 用于集成进主逻辑中的上层封装函数
func CompareAndSaveDiff(oldDir, newDir string) (string, error) {
	// 如果旧版本目录不存在（第一次上传），则无从比较
	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return "{}", nil
	}
	
	diffRes, err := CompareProtoDirectories(oldDir, newDir)
	if err != nil {
		return "", err
	}
	
	// 转成 JSON 字符串给 PocketBase 中的 diff_result 字段
	jsonBytes, err := json.Marshal(diffRes)
	if err != nil {
		return "", err
	}
	return string(jsonBytes), nil
}
