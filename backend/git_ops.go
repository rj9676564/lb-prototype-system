package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type GitCommitInfo struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

type GitStatusResponse struct {
	ConfiguredSourceDir string         `json:"source_dir"`
	IsGitRepo           bool           `json:"is_git_repo"`
	CurrentBranch       string         `json:"current_branch"`
	Branches            []string       `json:"branches"`
	RemoteBranches      []string       `json:"remote_branches"`
	RemoteUrl           string         `json:"remote_url"`
	IsClean             bool           `json:"is_clean"`
	ChangedFilesCount   int            `json:"changed_files_count"`
	ChangedFiles        []string       `json:"changed_files"`
	StatusText          string         `json:"status_text"`
	LatestCommit        *GitCommitInfo `json:"latest_commit"`
	Error               string         `json:"error,omitempty"`
}

type GitOpResponse struct {
	Success    bool   `json:"success"`
	Action     string `json:"action"` // "checkout", "pull", "push", "status"
	Command    string `json:"command"`
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	Timestamp  string `json:"timestamp"`
}

type GitCheckoutRequest struct {
	Target string `json:"target"` // "." 表示放弃修改还原，或者分支名
	Force  bool   `json:"force"`  // -f
	Clean  bool   `json:"clean"`  // 是否同时执行 git clean -fd 清理未跟踪文件
}

type GitPullRequest struct {
	Remote       string `json:"remote"`
	Branch       string `json:"branch"`
	DiscardLocal bool   `json:"discard_local"` // 拉取前是否先强制重置工作区
}

type GitPushRequest struct {
	Remote        string `json:"remote"`
	Branch        string `json:"branch"`
	CommitMessage string `json:"commit_message"`
	AutoCommit    bool   `json:"auto_commit"`
	Force         bool   `json:"force"`
}

type GitExecRequest struct {
	Command string `json:"command"`
}

var (
	gitMu       sync.Mutex
	gitLogsMu   sync.RWMutex
	gitLogsList []*GitOpResponse
	maxGitLogs  = 100
)

func addGitLog(entry *GitOpResponse) {
	gitLogsMu.Lock()
	defer gitLogsMu.Unlock()
	gitLogsList = append([]*GitOpResponse{entry}, gitLogsList...)
	if len(gitLogsList) > maxGitLogs {
		gitLogsList = gitLogsList[:maxGitLogs]
	}
}

func getGitLogs() []*GitOpResponse {
	gitLogsMu.RLock()
	defer gitLogsMu.RUnlock()
	copied := make([]*GitOpResponse, len(gitLogsList))
	copy(copied, gitLogsList)
	return copied
}

func clearGitLogs() {
	gitLogsMu.Lock()
	defer gitLogsMu.Unlock()
	gitLogsList = make([]*GitOpResponse, 0)
}

func getGitEnv(ctx context.Context, dir string) []string {
	env := os.Environ()
	resolve := func(key, variable, fallback string) string {
		cmd := exec.CommandContext(ctx, "git", "-C", dir, "config", "--get", key)
		if out, err := cmd.Output(); err == nil && strings.TrimSpace(string(out)) != "" {
			return strings.TrimSpace(string(out))
		}
		if value := os.Getenv(variable); value != "" {
			return value
		}
		return fallback
	}
	name := resolve("user.name", "GIT_USER_NAME", "Prototype Admin")
	email := resolve("user.email", "GIT_USER_EMAIL", "admin@prototype.local")
	// Preserve explicitly supplied author/committer overrides. Repository config
	// takes precedence over application defaults, so page configuration works.
	for key, value := range map[string]string{
		"GIT_AUTHOR_NAME": name, "GIT_COMMITTER_NAME": name,
		"GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_EMAIL": email,
	} {
		if os.Getenv(key) == "" {
			env = append(env, key+"="+value)
		}
	}
	return append(env, "GIT_TERMINAL_PROMPT=0")
}

func runGitCommand(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = getGitEnv(ctx, dir)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func fetchGitRepoStatus(sourceDir string) *GitStatusResponse {
	resp := &GitStatusResponse{
		ConfiguredSourceDir: sourceDir,
		Branches:            []string{},
		RemoteBranches:      []string{},
		ChangedFiles:        []string{},
		IsClean:             true,
	}

	if sourceDir == "" {
		resp.Error = "未配置有效的前端原型源目录 (PROTOTYPE_SOURCE_DIR)"
		return resp
	}

	gitDir := filepath.Join(sourceDir, ".git")
	if info, err := os.Stat(gitDir); err != nil || (!info.IsDir() && !isGitFile(gitDir)) {
		resp.Error = fmt.Sprintf("指定目录不是有效的 Git 仓库: %s", sourceDir)
		return resp
	}
	resp.IsGitRepo = true

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// 1. 获取当前分支
	if curBranch, err := runGitCommand(ctx, sourceDir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		resp.CurrentBranch = curBranch
	}

	// 2. 获取 Remote URL
	if remoteUrl, err := runGitCommand(ctx, sourceDir, "remote", "get-url", "origin"); err == nil {
		resp.RemoteUrl = remoteUrl
	} else if remoteUrl, err := runGitCommand(ctx, sourceDir, "config", "--get", "remote.origin.url"); err == nil {
		resp.RemoteUrl = remoteUrl
	}

	// 3. 获取本地分支列表
	if branchOut, err := runGitCommand(ctx, sourceDir, "branch", "--list", "--format=%(refname:short)"); err == nil && branchOut != "" {
		resp.Branches = strings.Split(branchOut, "\n")
	}

	// 4. 获取远程分支列表
	if rBranchOut, err := runGitCommand(ctx, sourceDir, "branch", "-r", "--format=%(refname:short)"); err == nil && rBranchOut != "" {
		for _, b := range strings.Split(rBranchOut, "\n") {
			cleanB := strings.TrimSpace(b)
			if cleanB != "" && !strings.Contains(cleanB, "->") {
				resp.RemoteBranches = append(resp.RemoteBranches, cleanB)
			}
		}
	}

	// 5. 获取未提交变动状态 (status -s)
	if statusCompact, err := runGitCommand(ctx, sourceDir, "status", "-s"); err == nil {
		if statusCompact != "" {
			resp.IsClean = false
			lines := strings.Split(statusCompact, "\n")
			resp.ChangedFilesCount = len(lines)
			resp.ChangedFiles = lines
		}
	}

	// 6. 获取详细 status 说明
	if statusText, err := runGitCommand(ctx, sourceDir, "status"); err == nil {
		resp.StatusText = statusText
	}

	// 7. 获取最近一次 Commit
	if logOut, err := runGitCommand(ctx, sourceDir, "log", "-1", "--pretty=format:%h\t%an\t%ad\t%s", "--date=iso"); err == nil && logOut != "" {
		parts := strings.Split(logOut, "\t")
		if len(parts) >= 4 {
			resp.LatestCommit = &GitCommitInfo{
				Hash:    parts[0],
				Author:  parts[1],
				Date:    parts[2],
				Subject: parts[3],
			}
		}
	}

	return resp
}

func isGitFile(path string) bool {
	// 支持 git worktree 或 submodule 中的 .git 文件
	content, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(string(content)), "gitdir:")
}

func executeGitCheckout(sourceDir string, req GitCheckoutRequest) *GitOpResponse {
	gitMu.Lock()
	defer gitMu.Unlock()

	start := time.Now()
	timestamp := time.Now().Format("2006-01-02 15:04:05")

	if sourceDir == "" {
		res := &GitOpResponse{
			Success:   false,
			Action:    "checkout",
			Command:   "git checkout",
			Error:     "未配置有效的前端原型源目录",
			Timestamp: timestamp,
		}
		addGitLog(res)
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var outputParts []string
	var fullCmd string
	var execErr error

	target := strings.TrimSpace(req.Target)
	if target == "" || target == "." {
		// 放弃所有未提交修改
		fullCmd = "git checkout . -f"
		out, err := runGitCommand(ctx, sourceDir, "checkout", ".", "-f")
		if out != "" {
			outputParts = append(outputParts, out)
		}
		if err != nil {
			execErr = err
		}

		if req.Clean {
			fullCmd += " && git clean -fd"
			cleanOut, cleanErr := runGitCommand(ctx, sourceDir, "clean", "-fd")
			if cleanOut != "" {
				outputParts = append(outputParts, cleanOut)
			}
			if execErr == nil && cleanErr != nil {
				execErr = cleanErr
			}
		}
	} else {
		// 切换指定分支
		args := []string{"checkout"}
		if req.Force {
			args = append(args, "-f")
		}
		args = append(args, target)
		fullCmd = "git " + strings.Join(args, " ")
		out, err := runGitCommand(ctx, sourceDir, args...)
		if out != "" {
			outputParts = append(outputParts, out)
		}
		execErr = err
	}

	combinedOutput := strings.Join(outputParts, "\n")
	if combinedOutput == "" && execErr == nil {
		combinedOutput = "工作区已还原为最新提交状态（无多余输出）"
	}

	res := &GitOpResponse{
		Success:    execErr == nil,
		Action:     "checkout",
		Command:    fullCmd,
		Output:     combinedOutput,
		DurationMs: time.Since(start).Milliseconds(),
		Timestamp:  timestamp,
	}
	if execErr != nil {
		res.Error = execErr.Error()
	}

	addGitLog(res)
	return res
}

func executeGitPull(sourceDir string, req GitPullRequest) *GitOpResponse {
	gitMu.Lock()
	defer gitMu.Unlock()

	start := time.Now()
	timestamp := time.Now().Format("2006-01-02 15:04:05")

	if sourceDir == "" {
		res := &GitOpResponse{
			Success:   false,
			Action:    "pull",
			Command:   "git pull",
			Error:     "未配置有效的前端原型源目录",
			Timestamp: timestamp,
		}
		addGitLog(res)
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var outputParts []string
	var fullCmdParts []string

	// 如果需要拉取前清理工作区，执行 checkout . -f
	if req.DiscardLocal {
		fullCmdParts = append(fullCmdParts, "git checkout . -f")
		out, err := runGitCommand(ctx, sourceDir, "checkout", ".", "-f")
		if out != "" {
			outputParts = append(outputParts, "[checkout . -f] "+out)
		}
		if err != nil {
			outputParts = append(outputParts, fmt.Sprintf("[checkout warning]: %v", err))
		}
	}

	remote := strings.TrimSpace(req.Remote)
	if remote == "" {
		remote = "origin"
	}
	branch := strings.TrimSpace(req.Branch)

	pullArgs := []string{"pull", remote}
	if branch != "" {
		pullArgs = append(pullArgs, branch)
	}
	pullCmdStr := "git " + strings.Join(pullArgs, " ")
	fullCmdParts = append(fullCmdParts, pullCmdStr)

	pullOut, pullErr := runGitCommand(ctx, sourceDir, pullArgs...)
	if pullOut != "" {
		outputParts = append(outputParts, pullOut)
	}

	combinedOutput := strings.Join(outputParts, "\n")
	if combinedOutput == "" && pullErr == nil {
		combinedOutput = "已拉取完成，已经是最新状态。"
	}

	res := &GitOpResponse{
		Success:    pullErr == nil,
		Action:     "pull",
		Command:    strings.Join(fullCmdParts, " && "),
		Output:     combinedOutput,
		DurationMs: time.Since(start).Milliseconds(),
		Timestamp:  timestamp,
	}
	if pullErr != nil {
		res.Error = pullErr.Error()
	}

	addGitLog(res)
	return res
}

func executeGitPush(sourceDir string, req GitPushRequest) *GitOpResponse {
	gitMu.Lock()
	defer gitMu.Unlock()

	start := time.Now()
	timestamp := time.Now().Format("2006-01-02 15:04:05")

	if sourceDir == "" {
		res := &GitOpResponse{
			Success:   false,
			Action:    "push",
			Command:   "git push",
			Error:     "未配置有效的前端原型源目录",
			Timestamp: timestamp,
		}
		addGitLog(res)
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var outputParts []string
	var fullCmdParts []string
	var execErr error

	commitMsg := strings.TrimSpace(req.CommitMessage)
	if req.AutoCommit || commitMsg != "" {
		if commitMsg == "" {
			commitMsg = fmt.Sprintf("docs(prototype): 手动同步原型 [%s]", time.Now().Format("2006-01-02 15:04"))
		}

		fullCmdParts = append(fullCmdParts, "git add -A")
		addOut, addErr := runGitCommand(ctx, sourceDir, "add", "-A")
		if addOut != "" {
			outputParts = append(outputParts, "[git add] "+addOut)
		}
		if addErr != nil {
			execErr = fmt.Errorf("git add failed: %w", addErr)
		} else {
			commitCmdStr := fmt.Sprintf("git commit -m %q", commitMsg)
			fullCmdParts = append(fullCmdParts, commitCmdStr)
			commitOut, commitErr := runGitCommand(ctx, sourceDir, "commit", "-m", commitMsg)
			if commitOut != "" {
				outputParts = append(outputParts, "[git commit] "+commitOut)
			}
			if commitErr != nil {
				if strings.Contains(commitOut, "nothing to commit") || strings.Contains(commitOut, "无文件要提交") || strings.Contains(commitOut, "clean") {
					outputParts = append(outputParts, "[提示] 工作区干净，无文件需要提交")
				} else {
					execErr = fmt.Errorf("git commit failed: %w", commitErr)
				}
			}
		}
	}

	if execErr == nil {
		remote := strings.TrimSpace(req.Remote)
		if remote == "" {
			remote = "origin"
		}
		branch := strings.TrimSpace(req.Branch)
		if branch == "" {
			// 自动解析当前分支
			if curBranch, err := runGitCommand(ctx, sourceDir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil && curBranch != "" {
				branch = curBranch
			} else {
				branch = "master"
			}
		}

		pushArgs := []string{"push"}
		if req.Force {
			pushArgs = append(pushArgs, "-f")
		}
		pushArgs = append(pushArgs, remote, branch)

		pushCmdStr := "git " + strings.Join(pushArgs, " ")
		fullCmdParts = append(fullCmdParts, pushCmdStr)

		pushOut, pushErr := runGitCommand(ctx, sourceDir, pushArgs...)
		if pushOut != "" {
			outputParts = append(outputParts, "[git push] "+pushOut)
		}
		if pushErr != nil {
			execErr = fmt.Errorf("git push failed: %w", pushErr)
		}
	}

	combinedOutput := strings.Join(outputParts, "\n")
	if combinedOutput == "" && execErr == nil {
		combinedOutput = "已成功执行 Git Push！"
	}

	res := &GitOpResponse{
		Success:    execErr == nil,
		Action:     "push",
		Command:    strings.Join(fullCmdParts, " && "),
		Output:     combinedOutput,
		DurationMs: time.Since(start).Milliseconds(),
		Timestamp:  timestamp,
	}
	if execErr != nil {
		res.Error = execErr.Error()
	}

	addGitLog(res)
	return res
}

// executeGitCustomCommand 执行自定义 Git 命令
func executeGitCustomCommand(sourceDir string, rawCmd string) *GitOpResponse {
	gitMu.Lock()
	defer gitMu.Unlock()

	start := time.Now()
	timestamp := start.Format("2006-01-02 15:04:05")

	trimmedCmd := strings.TrimSpace(rawCmd)
	if trimmedCmd == "" {
		return &GitOpResponse{
			Success:    false,
			Action:     "exec",
			Command:    "",
			Output:     "执行失败：命令不能为空",
			Error:      "命令不能为空",
			DurationMs: 0,
			Timestamp:  timestamp,
		}
	}

	if sourceDir == "" {
		return &GitOpResponse{
			Success:    false,
			Action:     "exec",
			Command:    trimmedCmd,
			Output:     "执行失败：未配置原型源目录 (PROTOTYPE_SOURCE_DIR)",
			Error:      "未配置原型源目录",
			DurationMs: 0,
			Timestamp:  timestamp,
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// 使用 sh -c 执行命令，便于支持管道、参数组合以及各种 git 指令
	cmd := exec.CommandContext(ctx, "sh", "-c", trimmedCmd)
	cmd.Dir = sourceDir
	cmd.Env = getGitEnv(ctx, sourceDir)

	outBytes, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(outBytes))

	res := &GitOpResponse{
		Success:    err == nil,
		Action:     "exec",
		Command:    trimmedCmd,
		Output:     output,
		DurationMs: time.Since(start).Milliseconds(),
		Timestamp:  timestamp,
	}
	if err != nil {
		res.Error = err.Error()
		if output == "" {
			res.Output = err.Error()
		}
	} else if output == "" {
		res.Output = "（命令执行成功，无任何终端输出）"
	}

	addGitLog(res)
	return res
}
