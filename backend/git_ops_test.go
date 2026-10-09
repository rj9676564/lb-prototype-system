package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCommitIdentityWithoutEnvironmentConfiguration(t *testing.T) {
	for _, key := range []string{"GIT_USER_NAME", "GIT_USER_EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"} {
		t.Setenv(key, "")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("ENABLE_GIT_PUSH", "false")
	t.Setenv("AUTO_GIT_PUSH", "false")
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "fallback", true: "repository_config"}[configured], func(t *testing.T) {
			dir := t.TempDir()
			ctx := context.Background()
			if out, err := runGitCommand(ctx, dir, "init"); err != nil {
				t.Fatalf("init: %v: %s", err, out)
			}
			want := "Prototype Admin <admin@prototype.local>"
			if configured {
				res := executeGitCustomCommand(dir, `git config user.name "laibin" && git config user.email "laibin6@gmail.com"`)
				if !res.Success {
					t.Fatal(res)
				}
				want = "laibin <laibin6@gmail.com>"
			}
			res := executeGitCustomCommand(dir, "git commit --allow-empty -m test")
			if !res.Success {
				t.Fatalf("commit: %s %s", res.Error, res.Output)
			}
			assertIdentity := func() {
				t.Helper()
				out, err := runGitCommand(ctx, dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>")
				if err != nil || out != want+"|"+want {
					t.Fatalf("identity = %q, want %q: %v", out, want+"|"+want, err)
				}
			}
			assertIdentity()
			if err := os.WriteFile(filepath.Join(dir, "upload.txt"), []byte("upload"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := tryGitCommitAndPush(dir, "upload.txt", "test", "v1"); err != nil {
				t.Fatal(err)
			}
			assertIdentity()
		})
	}
}

func createTestGitRepo(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "git_ops_test_*")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}

	// 初始化 Git
	cmdInit := exec.Command("git", "init", dir)
	if out, err := cmdInit.CombinedOutput(); err != nil {
		t.Fatalf("git init 失败: %v, 输出: %s", err, string(out))
	}

	// 配置用户名和邮箱
	exec.Command("git", "-C", dir, "config", "user.name", "TestUser").Run()
	exec.Command("git", "-C", dir, "config", "user.email", "test@example.com").Run()

	// 创建初始文件并提交
	testFile := filepath.Join(dir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test Repo\n"), 0644); err != nil {
		t.Fatalf("写入测试文件失败: %v", err)
	}

	cmdAdd := exec.Command("git", "-C", dir, "add", "-A")
	if out, err := cmdAdd.CombinedOutput(); err != nil {
		t.Fatalf("git add 失败: %v, 输出: %s", err, string(out))
	}

	cmdCommit := exec.Command("git", "-C", dir, "commit", "-m", "initial commit")
	if out, err := cmdCommit.CombinedOutput(); err != nil {
		t.Fatalf("git commit 失败: %v, 输出: %s", err, string(out))
	}

	return dir
}

func TestFetchGitRepoStatus(t *testing.T) {
	repoDir := createTestGitRepo(t)
	defer os.RemoveAll(repoDir)

	status := fetchGitRepoStatus(repoDir)
	if !status.IsGitRepo {
		t.Fatalf("预期为 Git 仓库，但返回 false: %s", status.Error)
	}
	if !status.IsClean {
		t.Errorf("预期工作区干净，实际为 dirty: %v", status.ChangedFiles)
	}
	if status.LatestCommit == nil || status.LatestCommit.Subject != "initial commit" {
		t.Errorf("最新提交预期为 'initial commit'，实际: %+v", status.LatestCommit)
	}

	// 制造未提交修改
	os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# Test Repo Modified\n"), 0644)
	statusDirty := fetchGitRepoStatus(repoDir)
	if statusDirty.IsClean {
		t.Errorf("预期工作区为 dirty，实际判定为 clean")
	}
	if statusDirty.ChangedFilesCount != 1 {
		t.Errorf("预期变动文件数为 1，实际: %d", statusDirty.ChangedFilesCount)
	}
}

func TestExecuteGitCheckoutReset(t *testing.T) {
	repoDir := createTestGitRepo(t)
	defer os.RemoveAll(repoDir)

	// 修改现有文件并创建新未跟踪文件
	os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# Changed content\n"), 0644)
	os.WriteFile(filepath.Join(repoDir, "untracked.txt"), []byte("untracked\n"), 0644)

	res := executeGitCheckout(repoDir, GitCheckoutRequest{
		Target: ".",
		Force:  true,
		Clean:  true,
	})

	if !res.Success {
		t.Fatalf("执行 git checkout 重置失败: %s", res.Error)
	}

	// 验证工作区已恢复干净
	status := fetchGitRepoStatus(repoDir)
	if !status.IsClean {
		t.Errorf("重置后工作区未干净: %v", status.ChangedFiles)
	}
}

func TestExecuteGitPushAutoCommit(t *testing.T) {
	// 创建一个作为裸仓库的 remote
	remoteDir, err := os.MkdirTemp("", "git_remote_test_*")
	if err != nil {
		t.Fatalf("创建临时 remote 目录失败: %v", err)
	}
	defer os.RemoveAll(remoteDir)

	cmdBare := exec.Command("git", "init", "--bare", remoteDir)
	if out, err := cmdBare.CombinedOutput(); err != nil {
		t.Fatalf("创建 bare 仓库失败: %v, 输出: %s", err, string(out))
	}

	repoDir := createTestGitRepo(t)
	defer os.RemoveAll(repoDir)

	// 添加 remote
	exec.Command("git", "-C", repoDir, "remote", "add", "origin", remoteDir).Run()

	// 添加新文件
	os.WriteFile(filepath.Join(repoDir, "new_feature.txt"), []byte("hello world\n"), 0644)

	// 获取当前分支
	curBranch := fetchGitRepoStatus(repoDir).CurrentBranch

	// 执行带 auto commit 的 push
	pushRes := executeGitPush(repoDir, GitPushRequest{
		Remote:        "origin",
		Branch:        curBranch,
		CommitMessage: "feat: add new feature",
		AutoCommit:    true,
	})

	if !pushRes.Success {
		t.Fatalf("执行 push 失败: %s, 输出: %s", pushRes.Error, pushRes.Output)
	}

	// 验证 push 后的工作区干净
	status := fetchGitRepoStatus(repoDir)
	if !status.IsClean {
		t.Errorf("Push 后工作区应为干净，实际: %v", status.ChangedFiles)
	}
	if status.LatestCommit.Subject != "feat: add new feature" {
		t.Errorf("预期最新提交为 'feat: add new feature'，实际: %s", status.LatestCommit.Subject)
	}
}

func TestExecuteGitCustomCommand(t *testing.T) {
	repoDir := createTestGitRepo(t)
	defer os.RemoveAll(repoDir)

	// 测试执行简单 git 命令
	res := executeGitCustomCommand(repoDir, "git status")
	if !res.Success {
		t.Fatalf("自定义命令执行失败: %s", res.Error)
	}

	// 测试空命令
	resEmpty := executeGitCustomCommand(repoDir, "")
	if resEmpty.Success {
		t.Errorf("空命令预期失败，实际成功")
	}

	// 测试命令输出
	resBranch := executeGitCustomCommand(repoDir, "git branch --show-current")
	if !resBranch.Success {
		t.Errorf("git branch 执行失败: %s", resBranch.Error)
	}
}
