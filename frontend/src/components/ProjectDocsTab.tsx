import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileMarkdownOutlined,
  LinkOutlined,
  PlusOutlined,
  SnippetsOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { pb } from "../lib/pocketbase";
import { API_URL } from "../providers/constants";
import { MarkdownView } from "./MarkdownView";

const { Text, Title, Paragraph } = Typography;

export type ProjectDocType = "api_doc" | "env_info" | "remark" | "other";

export interface ProjectDocRecord {
  id: string;
  project: string;
  title: string;
  doc_type?: ProjectDocType;
  external_url?: string;
  content?: string;
  file?: string;
  creator?: string;
  created: string;
  updated: string;
  expand?: {
    creator?: {
      id: string;
      email?: string;
      name?: string;
    };
  };
}

interface ProjectDocsTabProps {
  projectId: string;
  projectName?: string;
  currentUserId?: string;
  onCountChange?: (count: number) => void;
}

const DOC_TYPE_META: Record<ProjectDocType, { label: string; color: string }> = {
  api_doc: { label: "联调文档", color: "blue" },
  env_info: { label: "环境与账号", color: "green" },
  remark: { label: "联调备注", color: "orange" },
  other: { label: "其他", color: "default" },
};

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const INTEGRATION_TEMPLATE = `## 1. 服务与环境信息
- **测试环境 BaseURL**：\`https://api-dev.example.com\`
- **鉴权方式**：\`Authorization: Bearer <token>\`
- **测试账号**：\`13800138000 / 123456\`

## 2. 核心接口清单
| 模块 | 方法 | 路径 | 说明 |
| :--- | :--- | :--- | :--- |
| 示例模块 | GET | \`/api/v1/demo\` | 获取列表数据 |

## 3. 联调备注 / 注意事项
- 
`;

/**
 * 项目联调文档与备注管理面板，支持在线编写/编辑 Markdown、上传 .md 文件解析填充及渲染预览。
 */
export const ProjectDocsTab: React.FC<ProjectDocsTabProps> = ({
  projectId,
  projectName,
  currentUserId,
  onCountChange,
}) => {
  const { message } = App.useApp();
  const [docs, setDocs] = useState<ProjectDocRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<ProjectDocRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "split" | "preview">("split");
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [form] = Form.useForm();
  const watchedContent = Form.useWatch("content", form) || "";

  const isAuthenticated = Boolean(currentUserId || pb.authStore.record?.id);
  const activeUserId = currentUserId || pb.authStore.record?.id || "";

  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const messageRef = useRef(message);
  messageRef.current = message;

  const loadDocs = useCallback(
    async (preferredId?: string | null) => {
      if (!projectId) return;
      setLoading(true);
      try {
        const res = await pb.collection("rp_project_doc").getList<ProjectDocRecord>(1, 100, {
          filter: `project = "${projectId}"`,
          sort: "-updated",
          expand: "creator",
        });
        const items = res.items || [];
        setDocs(items);
        onCountChangeRef.current?.(items.length);

        setSelectedDocId((prev) => {
          const targetId = preferredId !== undefined ? preferredId : prev;
          if (targetId && items.some((item) => item.id === targetId)) {
            return targetId;
          }
          return items[0]?.id || null;
        });
      } catch (err: any) {
        messageRef.current.error(`加载联调文档失败: ${err?.message || "未知错误"}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const selectedDoc = useMemo(
    () => docs.find((item) => item.id === selectedDocId) || docs[0] || null,
    [docs, selectedDocId],
  );

  const openCreateModal = () => {
    setEditingDoc(null);
    setUploadFileList([]);
    setRemoveExistingFile(false);
    setEditorMode("split");
    form.resetFields();
    form.setFieldsValue({
      doc_type: "api_doc",
      content: "",
    });
    setModalOpen(true);
  };

  const openEditModal = (doc: ProjectDocRecord) => {
    setEditingDoc(doc);
    setUploadFileList([]);
    setRemoveExistingFile(false);
    setEditorMode("split");
    form.setFieldsValue({
      title: doc.title,
      doc_type: doc.doc_type || "api_doc",
      external_url: doc.external_url || "",
      content: doc.content || "",
    });
    setModalOpen(true);
  };

  const handleFileBeforeUpload = async (file: File) => {
    try {
      const text = await file.text();
      const currentTitle = form.getFieldValue("title")?.trim();
      if (!currentTitle) {
        const baseName = file.name.replace(/\.(md|markdown|txt)$/i, "");
        form.setFieldValue("title", baseName || file.name);
      }
      form.setFieldValue("content", text);
      setRemoveExistingFile(false);
      setUploadFileList([
        {
          uid: String(Date.now()),
          name: file.name,
          status: "done",
          originFileObj: file as any,
        },
      ]);
      message.success(`已解析文件「${file.name}」并填充到正文`);
    } catch {
      message.error("读取文件内容失败，请确认文件为 UTF-8 文本格式");
    }
    return false;
  };

  const handleInsertTemplate = () => {
    const current = (form.getFieldValue("content") || "").trim();
    const nextContent = current ? `${current}\n\n${INTEGRATION_TEMPLATE}` : INTEGRATION_TEMPLATE;
    form.setFieldValue("content", nextContent);
    message.success("已插入后端联调模板");
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const trimmedContent = (values.content || "").trim();
      const pendingFile = uploadFileList[0]?.originFileObj;

      if (!trimmedContent && !pendingFile && !(editingDoc?.file && !removeExistingFile)) {
        message.warning("请填写 Markdown 内容或上传 .md 文件");
        return;
      }

      setSaving(true);
      const formData = new FormData();
      formData.append("project", projectId);
      formData.append("title", values.title.trim());
      formData.append("doc_type", values.doc_type || "api_doc");
      formData.append("external_url", (values.external_url || "").trim());
      formData.append("content", values.content || "");

      if (pendingFile) {
        formData.append("file", pendingFile);
      } else if (editingDoc && removeExistingFile) {
        formData.append("file", "");
      }

      if (!editingDoc && activeUserId) {
        formData.append("creator", activeUserId);
      }

      let savedRecord: ProjectDocRecord;
      if (editingDoc) {
        savedRecord = await pb.collection("rp_project_doc").update<ProjectDocRecord>(editingDoc.id, formData);
        message.success("文档更新成功");
      } else {
        savedRecord = await pb.collection("rp_project_doc").create<ProjectDocRecord>(formData);
        message.success("文档创建成功");
      }

      setModalOpen(false);
      await loadDocs(savedRecord.id);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(`保存失败: ${err?.message || "请检查输入或登录状态"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (doc: ProjectDocRecord) => {
    try {
      await pb.collection("rp_project_doc").delete(doc.id);
      message.success("文档已删除");
      const nextPreferred = selectedDocId === doc.id ? null : selectedDocId;
      await loadDocs(nextPreferred);
    } catch (err: any) {
      message.error(`删除失败: ${err?.message || "无权限或网络错误"}`);
    }
  };

  const handleCopyMarkdown = async (doc: ProjectDocRecord) => {
    try {
      await navigator.clipboard.writeText(doc.content || "");
      message.success("已复制 Markdown 原文到剪贴板");
    } catch {
      message.error("复制失败，请手动选中复制");
    }
  };

  const handleDownloadMarkdown = (doc: ProjectDocRecord) => {
    if (doc.file) {
      window.open(`${API_URL}/files/rp_project_doc/${doc.id}/${doc.file}?download=1`, "_blank");
      return;
    }
    const blob = new Blob([doc.content || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.title || "doc"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      loading={loading && docs.length === 0}
      title={
        <Space>
          <FileMarkdownOutlined style={{ color: "#1677ff" }} />
          <span>{projectName ? `${projectName} - ` : ""}联调文档与备注</span>
          <Tag color="blue">{docs.length} 篇</Tag>
        </Space>
      }
      extra={
        isAuthenticated && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增文档 / 备注
          </Button>
        )
      }
    >
      {docs.length === 0 ? (
        <Empty description="暂无联调文档或备注">
          {isAuthenticated && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              添加第一篇联调文档
            </Button>
          )}
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6} lg={5}>
            <List
              bordered
              size="small"
              dataSource={docs}
              style={{ maxHeight: 680, overflowY: "auto", background: "#fafafa" }}
              renderItem={(item) => {
                const isSelected = selectedDoc?.id === item.id;
                const typeMeta = DOC_TYPE_META[item.doc_type || "api_doc"] || DOC_TYPE_META.other;
                return (
                  <List.Item
                    onClick={() => setSelectedDocId(item.id)}
                    style={{
                      cursor: "pointer",
                      backgroundColor: isSelected ? "#e6f4ff" : "transparent",
                      borderLeft: isSelected ? "3px solid #1677ff" : "3px solid transparent",
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ width: "100%", minWidth: 0 }}>
                      <Paragraph
                        strong
                        ellipsis={{ rows: 2, tooltip: item.title }}
                        style={{ marginBottom: 6, lineHeight: 1.4, wordBreak: "break-word" }}
                      >
                        {item.title}
                      </Paragraph>
                      <div style={{ fontSize: 12, color: "#8c8c8c", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                        <Tag color={typeMeta.color} style={{ marginRight: 0 }}>
                          {typeMeta.label}
                        </Tag>
                        <span style={{ whiteSpace: "nowrap" }}>{item.updated?.slice(5, 16).replace("T", " ")}</span>
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          </Col>

          <Col xs={24} md={18} lg={19}>
            {selectedDoc && (
              <Card
                size="small"
                style={{ minHeight: 420 }}
                title={
                  <Space wrap>
                    <Title level={5} style={{ margin: 0 }}>
                      {selectedDoc.title}
                    </Title>
                    <Tag color={(DOC_TYPE_META[selectedDoc.doc_type || "api_doc"] || DOC_TYPE_META.other).color}>
                      {(DOC_TYPE_META[selectedDoc.doc_type || "api_doc"] || DOC_TYPE_META.other).label}
                    </Tag>
                    {selectedDoc.external_url && (
                      <Button
                        type="link"
                        size="small"
                        icon={<LinkOutlined />}
                        href={selectedDoc.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        外部接口文档
                      </Button>
                    )}
                  </Space>
                }
                extra={
                  <Space wrap size="small">
                    <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopyMarkdown(selectedDoc)}>
                      复制原文
                    </Button>
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadMarkdown(selectedDoc)}>
                      导出 .md
                    </Button>
                    {isAuthenticated && (
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(selectedDoc)}
                      >
                        编辑
                      </Button>
                    )}
                    {isAuthenticated && activeUserId === selectedDoc.creator && (
                      <Popconfirm
                        title="确定删除这篇文档吗？"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDelete(selectedDoc)}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                }
              >
                <div style={{ marginBottom: 12, fontSize: 12, color: "#8c8c8c" }}>
                  <Space split={<span>·</span>} wrap>
                    <span>
                      作者：{selectedDoc.expand?.creator?.name || selectedDoc.expand?.creator?.email || "-"}
                    </span>
                    <span>更新于：{selectedDoc.updated?.slice(0, 19).replace("T", " ")}</span>
                    {selectedDoc.file && <span>附件：{selectedDoc.file}</span>}
                  </Space>
                </div>
                {selectedDoc.content ? (
                  <MarkdownView content={selectedDoc.content} />
                ) : (
                  <Empty description="暂无 Markdown 正文内容" />
                )}
              </Card>
            )}
          </Col>
        </Row>
      )}

      <Modal
        title={editingDoc ? `编辑文档：${editingDoc.title}` : "新增联调文档 / 备注"}
        open={modalOpen}
        zIndex={1100}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText={editingDoc ? "保存修改" : "确认添加"}
        cancelText="取消"
        width="85%"
        style={{ top: 24, maxWidth: 1180 }}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item
                label="文档标题"
                name="title"
                rules={[{ required: true, message: "请输入文档标题" }]}
              >
                <Input placeholder="例如：订单中心后端联调文档" maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="文档分类" name="doc_type" initialValue="api_doc">
                <Select options={DOC_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                label="外部文档链接（可选）"
                name="external_url"
                rules={[{ type: "url", message: "请输入有效的 http/https 链接" }]}
              >
                <Input placeholder="https://yapi.example.com/project/..." allowClear />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="上传 Markdown 文件（可选，上传后自动填充正文并保存附件）">
            <Space wrap align="center">
              <Upload
                accept=".md,.markdown,.txt"
                maxCount={1}
                fileList={uploadFileList}
                beforeUpload={handleFileBeforeUpload}
                onRemove={() => setUploadFileList([])}
              >
                <Button icon={<UploadOutlined />}>选择 .md / .markdown 文件</Button>
              </Upload>
              {editingDoc?.file && !removeExistingFile && uploadFileList.length === 0 && (
                <Space>
                  <Tag color="geekblue">当前附件：{editingDoc.file}</Tag>
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => setRemoveExistingFile(true)}
                  >
                    移除原附件
                  </Button>
                </Space>
              )}
              {removeExistingFile && <Tag color="warning">保存后将移除原附件</Tag>}
            </Space>
          </Form.Item>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Space>
              <Text strong>Markdown 正文</Text>
              <Button size="small" icon={<SnippetsOutlined />} onClick={handleInsertTemplate}>
                插入后端联调模板
              </Button>
            </Space>
            <Radio.Group
              size="small"
              value={editorMode}
              onChange={(e) => setEditorMode(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: "仅编辑", value: "edit" },
                { label: "左右分栏", value: "split" },
                { label: "仅预览", value: "preview" },
              ]}
            />
          </div>

          <Row gutter={16}>
            {editorMode !== "preview" && (
              <Col xs={24} md={editorMode === "split" ? 12 : 24}>
                <Form.Item name="content" noStyle>
                  <Input.TextArea
                    rows={16}
                    placeholder="支持直接输入 Markdown 或上传 .md 文件自动填充..."
                    style={{ fontFamily: "SFMono-Regular, Consolas, Monaco, monospace" }}
                  />
                </Form.Item>
              </Col>
            )}
            {editorMode !== "edit" && (
              <Col xs={24} md={editorMode === "split" ? 12 : 24}>
                <div
                  style={{
                    border: "1px solid #d9d9d9",
                    borderRadius: 6,
                    padding: "12px 16px",
                    height: 368,
                    overflowY: "auto",
                    background: "#fff",
                  }}
                >
                  {watchedContent.trim() ? (
                    <MarkdownView content={watchedContent} />
                  ) : (
                    <Text type="secondary">实时预览区域（输入 Markdown 后显示效果）</Text>
                  )}
                </div>
              </Col>
            )}
          </Row>
        </Form>
      </Modal>
    </Card>
  );
};
