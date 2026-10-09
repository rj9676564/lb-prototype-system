import React, { useState, useEffect, useRef } from "react";
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Button,
  Space,
  Input,
  Select,
  Checkbox,
  Popconfirm,
  Badge,
  Descriptions,
  Alert,
  Tabs,
  Collapse,
  message,
  Tooltip,
} from "antd";
import {
  BranchesOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  RollbackOutlined,
  ReloadOutlined,
  ClearOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  FolderOutlined,
  LinkOutlined,
  WarningOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { pb } from "../../lib/pocketbase";
import { API_URL } from "../../providers/constants";

const { Title, Text, Paragraph } = Typography;

interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

interface GitStatusResponse {
  source_dir: string;
  is_git_repo: boolean;
  current_branch: string;
  branches: string[];
  remote_branches: string[];
  remote_url: string;
  is_clean: boolean;
  changed_files_count: number;
  changed_files: string[];
  status_text: string;
  latest_commit?: GitCommitInfo;
  error?: string;
}

interface GitOpResponse {
  success: boolean;
  action: string;
  command: string;
  output: string;
  error?: string;
  duration_ms: number;
  timestamp: string;
}

export const GitOpsPage: React.FC = () => {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [logs, setLogs] = useState<GitOpResponse[]>([]);

  // Checkout 操作表单状态
  const [checkoutMode, setCheckoutMode] = useState<string>("reset");
  const [cleanUntracked, setCleanUntracked] = useState<boolean>(true);
  const [switchBranch, setSwitchBranch] = useState<string>("");
  const [forceSwitch, setForceSwitch] = useState<boolean>(false);

  // Pull 操作表单状态
  const [pullRemote, setPullRemote] = useState<string>("origin");
  const [pullBranch, setPullBranch] = useState<string>("");
  const [pullDiscardLocal, setPullDiscardLocal] = useState<boolean>(true);

  // Push 操作表单状态
  const [pushRemote, setPushRemote] = useState<string>("origin");
  const [pushBranch, setPushBranch] = useState<string>("");
  const [pushCommitMsg, setPushCommitMsg] = useState<string>("");
  const [pushAutoCommit, setPushAutoCommit] = useState<boolean>(true);
  const [pushForce, setPushForce] = useState<boolean>(false);

  // 自定义命令执行状态
  const [customCmd, setCustomCmd] = useState<string>("");

  const consoleEndRef = useRef<HTMLDivElement>(null);

  const getAuthHeader = () => {
    return {
      Authorization: pb.authStore.token ? `Bearer ${pb.authStore.token}` : "",
      "Content-Type": "application/json",
    };
  };

  const loadStatus = async (silent = false) => {
    if (!silent) setLoadingStatus(true);
    try {
      const res = await fetch(`${API_URL}/git/status`, {
        headers: getAuthHeader(),
      });
      const data = await res.json();
      setStatus(data);
      if (data?.current_branch) {
        if (!switchBranch) setSwitchBranch(data.current_branch);
        if (!pullBranch) setPullBranch(data.current_branch);
        if (!pushBranch) setPushBranch(data.current_branch);
      }
    } catch (err: any) {
      if (!silent) message.error("获取 Git 仓库状态失败: " + (err?.message || err));
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  };

  const loadLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/git/logs`, {
        headers: getAuthHeader(),
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
      }
    } catch {
      // 忽略日志拉取失败
    }
  };

  useEffect(() => {
    loadStatus();
    loadLogs();
  }, []);

  // 执行 Git Checkout
  const handleCheckout = async () => {
    setExecutingAction("checkout");
    try {
      const isReset = checkoutMode === "reset";
      const payload = isReset
        ? { target: ".", force: true, clean: cleanUntracked }
        : { target: switchBranch || ".", force: forceSwitch, clean: false };

      const res = await fetch(`${API_URL}/git/checkout`, {
        method: "POST",
        headers: getAuthHeader(),
        body: JSON.stringify(payload),
      });
      const result: GitOpResponse = await res.json();
      setLogs((prev) => [result, ...prev]);

      if (result.success) {
        message.success(isReset ? "工作区已成功重置！" : `已成功切换到分支: ${payload.target}`);
      } else {
        message.error(`Checkout 执行失败: ${result.error || result.output}`);
      }
      await loadStatus(true);
    } catch (err: any) {
      message.error("Checkout 请求异常: " + (err?.message || err));
    } finally {
      setExecutingAction(null);
    }
  };

  // 执行 Git Pull
  const handlePull = async () => {
    setExecutingAction("pull");
    try {
      const payload = {
        remote: pullRemote || "origin",
        branch: pullBranch || status?.current_branch || "master",
        discard_local: pullDiscardLocal,
      };

      const res = await fetch(`${API_URL}/git/pull`, {
        method: "POST",
        headers: getAuthHeader(),
        body: JSON.stringify(payload),
      });
      const result: GitOpResponse = await res.json();
      setLogs((prev) => [result, ...prev]);

      if (result.success) {
        message.success("Git Pull 拉取成功！");
      } else {
        message.error(`Pull 执行失败: ${result.error || result.output}`);
      }
      await loadStatus(true);
    } catch (err: any) {
      message.error("Pull 请求异常: " + (err?.message || err));
    } finally {
      setExecutingAction(null);
    }
  };

  // 执行 Git Push
  const handlePush = async () => {
    setExecutingAction("push");
    try {
      const payload = {
        remote: pushRemote || "origin",
        branch: pushBranch || status?.current_branch || "master",
        commit_message: pushCommitMsg,
        auto_commit: pushAutoCommit,
        force: pushForce,
      };

      const res = await fetch(`${API_URL}/git/push`, {
        method: "POST",
        headers: getAuthHeader(),
        body: JSON.stringify(payload),
      });
      const result: GitOpResponse = await res.json();
      setLogs((prev) => [result, ...prev]);

      if (result.success) {
        message.success("Git Push 推送成功！");
        setPushCommitMsg("");
      } else {
        message.error(`Push 执行失败: ${result.error || result.output}`);
      }
      await loadStatus(true);
    } catch (err: any) {
      message.error("Push 请求异常: " + (err?.message || err));
    } finally {
      setExecutingAction(null);
    }
  };

  // 清空日志
  const handleClearLogs = async () => {
    try {
      await fetch(`${API_URL}/git/logs/clear`, {
        method: "POST",
        headers: getAuthHeader(),
      });
      setLogs([]);
      message.success("日志已清空");
    } catch {
      setLogs([]);
    }
  };

  // 执行自定义命令
  const handleExecCommand = async (cmdToRun?: string) => {
    const command = (cmdToRun || customCmd).trim();
    if (!command) {
      message.warning("请输入要执行的命令");
      return;
    }
    setExecutingAction("exec");
    try {
      const res = await fetch(`${API_URL}/git/exec`, {
        method: "POST",
        headers: getAuthHeader(),
        body: JSON.stringify({ command }),
      });
      const result: GitOpResponse = await res.json();
      setLogs((prev) => [result, ...prev]);

      if (result.success) {
        message.success("命令执行成功！");
      } else {
        message.error(`命令执行失败: ${result.error || result.output}`);
      }
      await loadStatus(true);
    } catch (err: any) {
      message.error("执行请求异常: " + (err?.message || err));
    } finally {
      setExecutingAction(null);
    }
  };

  // 复制日志
  const handleCopyLogs = () => {
    if (logs.length === 0) {
      message.info("暂无日志可复制");
      return;
    }
    const text = logs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.action.toUpperCase()}] [${log.success ? "SUCCESS" : "FAILED"}] (${log.duration_ms}ms)\n$ ${log.command}\n${log.output}${log.error ? `\nError: ${log.error}` : ""}`
      )
      .join("\n\n" + "=".repeat(60) + "\n\n");

    navigator.clipboard.writeText(text);
    message.success("所有执行日志已复制到剪贴板");
  };

  // 整理所有候选分支列表
  const branchOptions = Array.from(
    new Set([...(status?.branches || []), ...(status?.remote_branches || [])])
  ).map((b) => ({ label: b, value: b.replace(/^origin\//, "") }));

  return (
    <div style={{ padding: "0 4px" }}>
      {/* 头部导航与操作区 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <BranchesOutlined style={{ marginRight: 8, color: "#1677ff" }} />
            Git 仓库同步与运维管理
          </Title>
          <Text type="secondary">
            支持手动执行工作区还原（Checkout）、远程拉取（Pull）与提交推送（Push），并实时查看终端命令日志。
          </Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined spin={loadingStatus} />}
            onClick={() => loadStatus()}
            loading={loadingStatus}
          >
            刷新状态
          </Button>
          <Button
            icon={<CopyOutlined />}
            onClick={handleCopyLogs}
            disabled={logs.length === 0}
          >
            复制日志
          </Button>
          <Button
            icon={<ClearOutlined />}
            onClick={handleClearLogs}
            disabled={logs.length === 0}
          >
            清空日志
          </Button>
        </Space>
      </div>

      {/* 仓库状态面板 */}
      {status && !status.is_git_repo && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="源目录不是有效的 Git 仓库"
          description={
            <div>
              <p>系统检测路径：<code>{status.source_dir || "未配置"}</code></p>
              <p style={{ margin: 0 }}>原因提示：{status.error || "未在源目录检测到 .git 版本库"}</p>
            </div>
          }
        />
      )}

      {status?.is_git_repo && (
        <Card
          size="small"
          style={{ marginBottom: 16, borderRadius: 8 }}
          title={
            <Space>
              <FolderOutlined style={{ color: "#fa8c16" }} />
              <span>仓库信息与工作区状态</span>
              {status.is_clean ? (
                <Tag color="success" icon={<CheckCircleOutlined />}>工作区干净 (Clean)</Tag>
              ) : (
                <Tag color="warning" icon={<WarningOutlined />}>
                  {status.changed_files_count} 个未提交变动 (Dirty)
                </Tag>
              )}
            </Space>
          }
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前分支: <Tag color="blue">{status.current_branch || "未知"}</Tag>
            </Text>
          }
        >
          <Descriptions size="small" column={{ xxl: 4, xl: 3, lg: 2, md: 2, sm: 1, xs: 1 }} bordered>
            <Descriptions.Item label="源目录绝对路径">
              <Text copyable code style={{ fontSize: 12 }}>{status.source_dir}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="远程仓库 (origin)">
              {status.remote_url ? (
                <Space>
                  <LinkOutlined />
                  <Text copyable style={{ fontSize: 12 }}>{status.remote_url}</Text>
                </Space>
              ) : (
                <Text type="secondary">未配置远程地址</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="当前分支">
              <Tag color="processing" icon={<BranchesOutlined />}>
                {status.current_branch}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="最新提交 Commit">
              {status.latest_commit ? (
                <Space direction="vertical" size={2}>
                  <div>
                    <Tag color="geekblue">{status.latest_commit.hash}</Tag>
                    <Text strong style={{ fontSize: 12 }}>{status.latest_commit.subject}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {status.latest_commit.author} · {status.latest_commit.date}
                  </Text>
                </Space>
              ) : (
                <Text type="secondary">暂无提交记录</Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          {/* 如果有未提交改动，提供折叠面板查看文件列表 */}
          {!status.is_clean && status.changed_files.length > 0 && (
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: "changed-files",
                  label: (
                    <Text type="warning" style={{ fontSize: 12 }}>
                      展开查看未提交的文件列表 ({status.changed_files.length} 个文件)
                    </Text>
                  ),
                  children: (
                    <div
                      style={{
                        maxHeight: 180,
                        overflowY: "auto",
                        background: "rgba(0,0,0,0.02)",
                        padding: "8px 12px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {status.changed_files.map((file, idx) => (
                        <div key={idx} style={{ padding: "2px 0" }}>
                          <code>{file}</code>
                        </div>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* 三大操作卡片区域 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* 卡片 1: Checkout */}
        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <RollbackOutlined style={{ color: "#fa541c" }} />
                <span>Git Checkout</span>
              </Space>
            }
            size="small"
            style={{ height: "100%", borderRadius: 8, display: "flex", flexDirection: "column" }}
            bodyStyle={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          >
            <div>
              <Tabs
                size="small"
                activeKey={checkoutMode}
                onChange={setCheckoutMode}
                items={[
                  {
                    key: "reset",
                    label: "放弃修改还原",
                    children: (
                      <div>
                        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                          执行 <code>git checkout . -f</code> 强制丢弃本地未提交的改动，恢复到纯净状态。
                        </Paragraph>
                        <Checkbox
                          checked={cleanUntracked}
                          onChange={(e) => setCleanUntracked(e.target.checked)}
                          style={{ fontSize: 12 }}
                        >
                          同时清理新增未跟踪文件 (<code>git clean -fd</code>)
                        </Checkbox>
                      </div>
                    ),
                  },
                  {
                    key: "branch",
                    label: "切换分支",
                    children: (
                      <div>
                        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                          执行 <code>git checkout [branch]</code> 切换本地/远程分支。
                        </Paragraph>
                        <Space direction="vertical" style={{ width: "100%" }}>
                          <Select
                            placeholder="选择或输入分支名"
                            value={switchBranch || undefined}
                            onChange={setSwitchBranch}
                            style={{ width: "100%" }}
                            showSearch
                            allowClear
                            options={branchOptions}
                          />
                          <Checkbox
                            checked={forceSwitch}
                            onChange={(e) => setForceSwitch(e.target.checked)}
                            style={{ fontSize: 12 }}
                          >
                            强制切换 (<code>-f</code>)
                          </Checkbox>
                        </Space>
                      </div>
                    ),
                  },
                ]}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              {checkoutMode === "reset" ? (
                <Popconfirm
                  title="确认重置工作区？"
                  description="这将彻底丢弃当前所有未提交的文件修改，不可恢复！"
                  onConfirm={handleCheckout}
                  okText="确定重置"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    block
                    icon={<RollbackOutlined />}
                    loading={executingAction === "checkout"}
                    disabled={!status?.is_git_repo || executingAction !== null}
                  >
                    执行 Checkout 重置
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  block
                  icon={<SwapOutlined />}
                  onClick={handleCheckout}
                  loading={executingAction === "checkout"}
                  disabled={!status?.is_git_repo || !switchBranch || executingAction !== null}
                >
                  执行切换分支
                </Button>
              )}
            </div>
          </Card>
        </Col>

        {/* 卡片 2: Pull */}
        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <CloudDownloadOutlined style={{ color: "#1677ff" }} />
                <span>Git Pull</span>
              </Space>
            }
            size="small"
            style={{ height: "100%", borderRadius: 8, display: "flex", flexDirection: "column" }}
            bodyStyle={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          >
            <div>
              <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                从远程仓库拉取最新代码合并到本地，保持原型代码最新。
              </Paragraph>
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>远程目标分支：</Text>
                  <Input
                    prefix={<BranchesOutlined />}
                    value={pullBranch}
                    onChange={(e) => setPullBranch(e.target.value)}
                    placeholder={status?.current_branch || "master"}
                    size="small"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>远程库名称：</Text>
                  <Input
                    value={pullRemote}
                    onChange={(e) => setPullRemote(e.target.value)}
                    placeholder="origin"
                    size="small"
                  />
                </div>
                <Checkbox
                  checked={pullDiscardLocal}
                  onChange={(e) => setPullDiscardLocal(e.target.checked)}
                  style={{ fontSize: 12, marginTop: 4 }}
                >
                  拉取前自动清理本地修改 (<code>checkout . -f</code>)，避免产生冲突
                </Checkbox>
              </Space>
            </div>

            <div style={{ marginTop: 16 }}>
              <Button
                type="primary"
                block
                icon={<CloudDownloadOutlined />}
                onClick={handlePull}
                loading={executingAction === "pull"}
                disabled={!status?.is_git_repo || executingAction !== null}
              >
                执行 Git Pull
              </Button>
            </div>
          </Card>
        </Col>

        {/* 卡片 3: Push */}
        <Col xs={24} md={8}>
          <Card
            title={
              <Space>
                <CloudUploadOutlined style={{ color: "#52c41a" }} />
                <span>Git Push</span>
              </Space>
            }
            size="small"
            style={{ height: "100%", borderRadius: 8, display: "flex", flexDirection: "column" }}
            bodyStyle={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          >
            <div>
              <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 10 }}>
                将本地工作区的修改提交并推送到指定的远程分支。
              </Paragraph>
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>推送到分支：</Text>
                  <Input
                    prefix={<BranchesOutlined />}
                    value={pushBranch}
                    onChange={(e) => setPushBranch(e.target.value)}
                    placeholder={status?.current_branch || "master"}
                    size="small"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>提交信息 (Commit Message)：</Text>
                  <Input
                    value={pushCommitMsg}
                    onChange={(e) => setPushCommitMsg(e.target.value)}
                    placeholder="选填，如: 手动同步原型更新"
                    size="small"
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <Checkbox
                    checked={pushAutoCommit}
                    onChange={(e) => setPushAutoCommit(e.target.checked)}
                    style={{ fontSize: 12 }}
                  >
                    自动 <code>git add -A</code> 并提交
                  </Checkbox>
                  <Checkbox
                    checked={pushForce}
                    onChange={(e) => setPushForce(e.target.checked)}
                    style={{ fontSize: 12, color: pushForce ? "#ff4d4f" : undefined }}
                  >
                    强制推送 (<code>-f</code>)
                  </Checkbox>
                </div>
              </Space>
            </div>

            <div style={{ marginTop: 16 }}>
              <Popconfirm
                title="确定要执行 Git Push 吗？"
                description={
                  pushForce
                    ? "警告：您勾选了【强制推送 (-f)】，可能会覆盖远程提交，请务必确认！"
                    : "将把当前修改推送到远程仓库分支。"
                }
                onConfirm={handlePush}
                okText="确认推送"
                cancelText="取消"
                okButtonProps={pushForce ? { danger: true } : {}}
              >
                <Button
                  type="primary"
                  block
                  style={{
                    backgroundColor: "#52c41a",
                    borderColor: "#52c41a",
                  }}
                  icon={<CloudUploadOutlined />}
                  loading={executingAction === "push"}
                  disabled={!status?.is_git_repo || executingAction !== null}
                >
                  执行 Git Push
                </Button>
              </Popconfirm>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 自定义命令执行区 */}
      <Card
        size="small"
        style={{
          borderRadius: 8,
          marginBottom: 16,
          background: "#fafafa",
          border: "1px solid #d9d9d9",
        }}
        title={
          <Space>
            <CodeOutlined style={{ color: "#722ed1" }} />
            <span style={{ fontWeight: 600 }}>自定义 Git / Shell 命令执行</span>
            <Tag color="purple">管理员运维</Tag>
          </Space>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            在此可直接在原型目录执行任意 Git 维护指令（例如配置用户名邮箱、设置仓库凭据、查看分支或日志等）。
          </Text>
        </div>

        {/* 快捷常用命令标签 */}
        <div style={{ marginBottom: 12 }}>
          <Space wrap size={[6, 8]}>
            <Text type="secondary" style={{ fontSize: 12 }}>常用快捷命令：</Text>
            <Tag
              style={{ cursor: "pointer" }}
              color="blue"
              onClick={() => setCustomCmd('git config user.name "laibin" && git config user.email "laibin6@gmail.com"')}
            >
              配置提交者身份
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="blue"
              onClick={() => setCustomCmd("git status")}
            >
              git status
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="blue"
              onClick={() => setCustomCmd("git remote -v")}
            >
              git remote -v
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="blue"
              onClick={() => setCustomCmd("git branch -a")}
            >
              git branch -a
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="blue"
              onClick={() => setCustomCmd("git log -n 5 --oneline")}
            >
              git log (近5条)
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="orange"
              onClick={() => setCustomCmd('git config credential.helper store')}
            >
              启用凭据持久化助手
            </Tag>
            <Tag
              style={{ cursor: "pointer" }}
              color="cyan"
              onClick={() => setCustomCmd("git remote set-url origin https://<username>:<token>@git-repositories.juhesaas.com/xxx.git")}
            >
              设置带Token的Remote URL
            </Tag>
          </Space>
        </div>

        {/* 命令输入与执行按钮 */}
        <Space.Compact style={{ width: "100%" }}>
          <Input
            prefix={<span style={{ color: "#8c8c8c", fontFamily: "monospace" }}>$</span>}
            placeholder="输入要执行的 Git 命令，例如: git config user.name 'laibin' 或 git log -n 3"
            value={customCmd}
            onChange={(e) => setCustomCmd(e.target.value)}
            onPressEnter={() => handleExecCommand()}
            disabled={executingAction !== null}
            allowClear
          />
          <Button
            type="primary"
            style={{ backgroundColor: "#722ed1", borderColor: "#722ed1" }}
            onClick={() => handleExecCommand()}
            loading={executingAction === "exec"}
            disabled={!customCmd.trim() || executingAction !== null}
          >
            执行命令
          </Button>
        </Space.Compact>
      </Card>

      {/* 终端控制台日志窗口 */}
      <Card
        size="small"
        style={{
          borderRadius: 8,
          background: "#141414",
          borderColor: "#303030",
        }}
        title={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Space>
              <CodeOutlined style={{ color: "#52c41a" }} />
              <span style={{ color: "#efefef", fontWeight: 600 }}>终端执行日志 (Terminal Logs)</span>
              {executingAction && (
                <Tag color="processing">正在执行 {executingAction}...</Tag>
              )}
            </Space>
            <Space size={8}>
              <Text style={{ color: "#8c8c8c", fontSize: 12 }}>
                共 {logs.length} 条记录
              </Text>
            </Space>
          </div>
        }
      >
        <div
          style={{
            minHeight: 260,
            maxHeight: 480,
            overflowY: "auto",
            fontFamily: "SFMono-Regular, Consolas, Monaco, 'Liberation Mono', Menlo, monospace",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "#d4d4d4",
            padding: "4px 8px",
          }}
        >
          {logs.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 0",
                color: "#666",
              }}
            >
              <CodeOutlined style={{ fontSize: 24, marginBottom: 8 }} />
              <div>暂无 Git 执行日志，点击上方按钮触发 Checkout、Pull 或 Push 后在此显示输出。</div>
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                style={{
                  marginBottom: 16,
                  paddingBottom: 12,
                  borderBottom: index < logs.length - 1 ? "1px dashed #2a2a2a" : "none",
                }}
              >
                {/* 命令行状态头部 */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <Space size={6}>
                    <Text style={{ color: "#6e7681", fontSize: 11 }}>[{log.timestamp}]</Text>
                    {log.success ? (
                      <Tag color="success" style={{ margin: 0, padding: "0 4px", fontSize: 11 }}>
                        SUCCESS
                      </Tag>
                    ) : (
                      <Tag color="error" style={{ margin: 0, padding: "0 4px", fontSize: 11 }}>
                        FAILED
                      </Tag>
                    )}
                    <span style={{ color: "#58a6ff", fontWeight: 600 }}>$ {log.command}</span>
                  </Space>
                  <Space size={4}>
                    <ClockCircleOutlined style={{ color: "#8c8c8c", fontSize: 11 }} />
                    <span style={{ color: "#8c8c8c", fontSize: 11 }}>{log.duration_ms}ms</span>
                  </Space>
                </div>

                {/* 命令输出内容 */}
                {log.output && (
                  <pre
                    style={{
                      margin: "4px 0 0 0",
                      padding: "8px 12px",
                      background: "#1e1e1e",
                      borderRadius: 4,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      color: "#b3b3b3",
                    }}
                  >
                    {log.output}
                  </pre>
                )}

                {/* 错误信息 */}
                {log.error && (
                  <div
                    style={{
                      marginTop: 4,
                      padding: "6px 12px",
                      background: "rgba(255, 77, 79, 0.15)",
                      borderRadius: 4,
                      color: "#ff7875",
                      borderLeft: "3px solid #ff4d4f",
                    }}
                  >
                    {log.error}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>
      </Card>
    </div>
  );
};
