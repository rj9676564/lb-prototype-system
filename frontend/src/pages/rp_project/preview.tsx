import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  App,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CloseOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FileMarkdownOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { pb } from "../../lib/pocketbase";
import { API_URL, BASE_URL } from "../../providers/constants";
import { MarkdownView } from "../../components/MarkdownView";
import { ProjectDocsTab, type ProjectDocRecord, type ProjectDocType } from "../../components/ProjectDocsTab";

const { Text } = Typography;

const DOC_TYPE_META: Record<ProjectDocType, { label: string; color: string }> = {
  api_doc: { label: "联调文档", color: "blue" },
  env_info: { label: "环境与账号", color: "green" },
  remark: { label: "联调备注", color: "orange" },
  other: { label: "其他", color: "default" },
};

/**
 * 独立分屏预览工作台：左侧全屏展示原型内容，右侧默认收起为一个悬浮按钮，点击展开联调文档悬浮窗并支持切换文档。
 */
export const ProjectPreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { data: user } = useGetIdentity<any>();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [docs, setDocs] = useState<ProjectDocRecord[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");

  const [docOpen, setDocOpen] = useState(false);
  const [widePanel, setWidePanel] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [projRes, protoRes, docsRes] = await Promise.all([
        pb.collection("rp_project").getOne(id),
        pb.collection("rp_prototype").getList(1, 50, {
          filter: `project = "${id}"`,
          sort: "-created",
        }),
        pb.collection("rp_project_doc").getList<ProjectDocRecord>(1, 100, {
          filter: `project = "${id}"`,
          sort: "-updated",
          expand: "creator",
        }),
      ]);

      setProject(projRes);
      const protoItems = protoRes.items || [];
      setVersions(protoItems);
      setSelectedVersionId((prev) =>
        prev && protoItems.some((item) => item.id === prev) ? prev : protoItems[0]?.id || "",
      );

      const docItems = docsRes.items || [];
      setDocs(docItems);
      setSelectedDocId((prev) =>
        prev && docItems.some((item) => item.id === prev) ? prev : docItems[0]?.id || "",
      );
    } catch (err: any) {
      message.error(`加载预览失败: ${err?.message || "项目不存在或无访问权限"}`);
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (project?.name) {
      document.title = `${project.name} - 原型预览`;
    }
  }, [project?.name]);

  const reloadDocsOnly = useCallback(async () => {
    if (!id) return;
    try {
      const docsRes = await pb.collection("rp_project_doc").getList<ProjectDocRecord>(1, 100, {
        filter: `project = "${id}"`,
        sort: "-updated",
        expand: "creator",
      });
      const docItems = docsRes.items || [];
      setDocs(docItems);
      setSelectedDocId((prev) =>
        prev && docItems.some((item) => item.id === prev) ? prev : docItems[0]?.id || "",
      );
    } catch {
      // ignore background refresh error
    }
  }, [id]);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || versions[0] || null,
    [versions, selectedVersionId],
  );

  const selectedDoc = useMemo(
    () => docs.find((d) => d.id === selectedDocId) || docs[0] || null,
    [docs, selectedDocId],
  );

  const prototypeSrc = useMemo(() => {
    if (!project) return "";
    if (project.source_type === "url" && project.url) {
      return project.url;
    }
    const rawUrl = selectedVersion?.url;
    if (!rawUrl) return "";
    const fullUrl = rawUrl.startsWith("/") ? `${BASE_URL}${rawUrl}` : rawUrl;
    const separator = fullUrl.includes("?") ? "&" : "?";
    const ver = selectedVersion?.updated
      ? encodeURIComponent(selectedVersion.updated)
      : Date.now().toString();
    return `${fullUrl}${separator}v=${ver}`;
  }, [project, selectedVersion]);

  const handleCopyDoc = async () => {
    if (!selectedDoc?.content) return;
    try {
      await navigator.clipboard.writeText(selectedDoc.content);
      message.success("已复制 Markdown 原文");
    } catch {
      message.error("复制失败");
    }
  };

  const handleDownloadDoc = () => {
    if (!selectedDoc) return;
    if (selectedDoc.file) {
      window.open(`${API_URL}/files/rp_project_doc/${selectedDoc.id}/${selectedDoc.file}?download=1`, "_blank");
      return;
    }
    const blob = new Blob([selectedDoc.content || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedDoc.title || "doc"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          width: "100vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f5",
        }}
      >
        <Spin size="large" tip="正在加载原型预览..." />
      </div>
    );
  }

  if (!project) {
    return (
      <div
        style={{
          height: "100vh",
          width: "100vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f5",
        }}
      >
        <Empty description="未找到该项目或暂无访问权限" />
      </div>
    );
  }

  const isMarkdownProject = project.source_type === "markdown";

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#fff" }}>
      {/* 左侧/主区域：原型内容 */}
      <div style={{ width: "100%", height: "100%", overflow: isMarkdownProject ? "auto" : "hidden" }}>
        {isMarkdownProject ? (
          <div style={{ maxWidth: 960, margin: "24px auto", padding: "0 24px 48px" }}>
            <Card title={project.name}>
              <MarkdownView content={project.markdown} />
            </Card>
          </div>
        ) : prototypeSrc ? (
          <iframe
            src={prototypeSrc}
            title={project.name || "原型预览"}
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fafafa",
            }}
          >
            <Empty description="该项目暂无可预览的原型页面">
              <Button type="primary" href={`/rp_project/show/${project.id}`}>
                前往项目详情
              </Button>
            </Empty>
          </div>
        )}
      </div>

      {/* 默认收起状态：右侧边缘仅显示一个悬浮按钮 */}
      {!docOpen && (
        <div
          style={{
            position: "fixed",
            right: 20,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 900,
          }}
        >
          <Badge count={docs.length} offset={[-4, 4]} size="small">
            <Button
              type="primary"
              size="large"
              icon={<FileMarkdownOutlined />}
              onClick={() => setDocOpen(true)}
              style={{
                borderRadius: 24,
                boxShadow: "0 6px 20px rgba(22, 119, 255, 0.35)",
                height: 44,
                padding: "0 18px",
                fontWeight: 500,
              }}
            >
              联调文档
            </Button>
          </Badge>
        </div>
      )}

      {/* 展开状态：右侧悬浮窗，支持切换文档与管理 */}
      {docOpen && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            bottom: 16,
            width: widePanel ? "min(860px, calc(100vw - 32px))" : "min(560px, calc(100vw - 32px))",
            zIndex: 901,
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.2)",
            border: "1px solid #e8e8e8",
            overflow: "hidden",
            transition: "width 0.2s ease",
          }}
        >
          {/* 悬浮窗头部：项目/版本切换 + 宽度/关闭按钮 */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #f0f0f0",
              background: "#fafafa",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Space size={8} wrap style={{ minWidth: 0 }}>
              <FileMarkdownOutlined style={{ color: "#1677ff", fontSize: 16 }} />
              <Text strong ellipsis style={{ maxWidth: 200 }}>
                {project.name}
              </Text>
              {versions.length > 1 && project.source_type !== "url" && !isMarkdownProject && (
                <Select
                  size="small"
                  value={selectedVersion?.id}
                  onChange={setSelectedVersionId}
                  style={{ width: 150 }}
                  options={versions.map((v) => ({
                    value: v.id,
                    label: v.title || v.created?.slice(0, 10),
                  }))}
                />
              )}
            </Space>
            <Space size={4}>
              {prototypeSrc && (
                <Tooltip title="新窗口打开纯原型">
                  <Button
                    size="small"
                    type="text"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(prototypeSrc, "_blank", "noopener,noreferrer")}
                  />
                </Tooltip>
              )}
              <Tooltip title={widePanel ? "恢复标准宽度" : "加宽文档窗口"}>
                <Button
                  size="small"
                  type="text"
                  icon={<ColumnWidthOutlined />}
                  onClick={() => setWidePanel((v) => !v)}
                />
              </Tooltip>
              <Tooltip title="收起为悬浮按钮">
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => setDocOpen(false)}
                />
              </Tooltip>
            </Space>
          </div>

          {/* 悬浮窗工具栏：切换文档 + 快捷操作 */}
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #f0f0f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              {docs.length > 0 ? (
                <Select
                  style={{ width: "100%" }}
                  value={selectedDoc?.id}
                  onChange={setSelectedDocId}
                  placeholder="选择要查看的联调文档"
                  options={docs.map((d) => {
                    const meta = DOC_TYPE_META[d.doc_type || "api_doc"] || DOC_TYPE_META.other;
                    return {
                      value: d.id,
                      label: (
                        <Space size={6}>
                          <Tag color={meta.color} style={{ margin: 0 }}>
                            {meta.label}
                          </Tag>
                          <span>{d.title}</span>
                        </Space>
                      ),
                    };
                  })}
                />
              ) : (
                <Text type="secondary">暂无联调文档</Text>
              )}
            </div>
            <Space size={4}>
              {selectedDoc && (
                <>
                  {selectedDoc.external_url && (
                    <Tooltip title="打开外部接口文档">
                      <Button
                        size="small"
                        icon={<LinkOutlined />}
                        href={selectedDoc.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    </Tooltip>
                  )}
                  <Tooltip title="复制 Markdown 原文">
                    <Button size="small" icon={<CopyOutlined />} onClick={handleCopyDoc} />
                  </Tooltip>
                  <Tooltip title="导出 .md">
                    <Button size="small" icon={<DownloadOutlined />} onClick={handleDownloadDoc} />
                  </Tooltip>
                </>
              )}
              <Button
                size="small"
                type="primary"
                ghost
                icon={<EditOutlined />}
                onClick={() => setManageOpen(true)}
              >
                {docs.length > 0 ? "管理 / 编辑" : "添加文档"}
              </Button>
            </Space>
          </div>

          {/* 悬浮窗正文内容区 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {selectedDoc ? (
              <>
                <div style={{ marginBottom: 12, fontSize: 12, color: "#8c8c8c" }}>
                  <Space split={<span>·</span>} wrap>
                    <span>
                      作者：{selectedDoc.expand?.creator?.name || selectedDoc.expand?.creator?.email || "-"}
                    </span>
                    <span>更新于：{selectedDoc.updated?.slice(0, 19).replace("T", " ")}</span>
                  </Space>
                </div>
                {selectedDoc.content ? (
                  <MarkdownView content={selectedDoc.content} />
                ) : (
                  <Empty description="该文档暂无 Markdown 正文内容" />
                )}
              </>
            ) : (
              <Empty description="暂无联调文档或备注" style={{ marginTop: 64 }}>
                <Button type="primary" icon={<EditOutlined />} onClick={() => setManageOpen(true)}>
                  添加第一篇联调文档
                </Button>
              </Empty>
            )}
          </div>
        </div>
      )}

      {/* 文档增删改管理抽屉 */}
      <Drawer
        title={`${project.name} - 联调文档管理`}
        placement="right"
        width="80%"
        zIndex={1050}
        open={manageOpen}
        onClose={() => {
          setManageOpen(false);
          reloadDocsOnly();
        }}
        destroyOnClose
      >
        <ProjectDocsTab
          projectId={project.id}
          projectName={project.name}
          currentUserId={user?.id}
          onCountChange={() => {
            reloadDocsOnly();
          }}
        />
      </Drawer>
    </div>
  );
};
