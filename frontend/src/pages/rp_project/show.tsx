import React, { useState, useEffect, useMemo } from "react";
import { useShow, useGetIdentity } from "@refinedev/core";
import { Show, DateField, EditButton } from "@refinedev/antd";
import {
  Typography,
  Image,
  Descriptions,
  Card,
  Tabs,
  Table,
  Tag,
  Button,
  Space,
  Tooltip,
  Badge,
  List,
  Empty,
  Drawer,
  Select,
  Divider,
  Timeline,
  Row,
  Col,
  Statistic,
  Input,
  Radio,
  Collapse,
} from "antd";
import {
  GlobalOutlined,
  PlusOutlined,
  DownloadOutlined,
  MinusOutlined,
  EditOutlined,
  ExportOutlined,
  DiffOutlined,
  HistoryOutlined,
  SearchOutlined,
  FileAddOutlined,
  FileExcelOutlined,
  FileDoneOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SwapOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router";
import { pb } from "../../lib/pocketbase";
import { API_URL, BASE_URL } from "../../providers/constants";

const { Title, Text, Paragraph } = Typography;

// 字符级差异高亮渲染
const renderDiff = (oldStr: string, newStr: string) => {
  const commonPrefix = (s1: string, s2: string) => {
    let i = 0;
    while (i < s1.length && i < s2.length && s1[i] === s2[i]) {
      i++;
    }
    return i;
  };
  const commonSuffix = (s1: string, s2: string) => {
    let i = 0;
    while (i < s1.length && i < s2.length && s1[s1.length - 1 - i] === s2[s2.length - 1 - i]) {
      i++;
    }
    return i;
  };

  const pref = commonPrefix(oldStr, newStr);
  const suff = Math.min(
    commonSuffix(oldStr.slice(pref), newStr.slice(pref)),
    oldStr.length - pref,
    newStr.length - pref,
  );

  return {
    prefix: oldStr.slice(0, pref),
    oldDiff: oldStr.slice(pref, oldStr.length - suff),
    newDiff: newStr.slice(pref, newStr.length - suff),
    suffix: oldStr.slice(oldStr.length - suff),
  };
};

const parseDiffResult = (diff: any) => {
  if (!diff) return null;
  if (typeof diff === "object") return diff;
  try {
    return JSON.parse(diff);
  } catch {
    return null;
  }
};

export const ProjectShow = () => {
  const { query } = useShow<any>({
    meta: {
      expand: "creator",
    },
  });
  const { data, isLoading } = query;
  const record = data?.data;
  const { data: user } = useGetIdentity<any>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<string>("all-diffs");
  const [versions, setVersions] = useState<any[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterDiffType, setFilterDiffType] = useState<string>("all");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [drawerTitle, setDrawerTitle] = useState<string>("");

  const isCreator = user?.id === record?.creator;

  useEffect(() => {
    if (!record?.id) return;

    let cancelled = false;
    const fetchVersions = async () => {
      setLoadingVersions(true);
      try {
        const res = await pb.collection("rp_prototype").getList(1, 100, {
          filter: `project = "${record.id}"`,
          sort: "-created",
          expand: "creator",
        });
        if (!cancelled) {
          setVersions(res.items || []);
          if (res.items?.length > 0) {
            setSelectedVersionId(res.items[0].id);
          }
        }
      } catch {
        if (!cancelled) {
          setVersions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingVersions(false);
        }
      }
    };

    fetchVersions();

    return () => {
      cancelled = true;
    };
  }, [record?.id]);

  const latestVersion = versions[0];
  const selectedVersion = versions.find((v) => v.id === selectedVersionId) || latestVersion;

  const openPreview = (url: string, title: string) => {
    const fullUrl = url.startsWith("/") ? `${BASE_URL}${url}` : url;
    setPreviewUrl(fullUrl);
    setDrawerTitle(title);
  };

  const statusMap: Record<string, { label: string; color: string }> = {
    draft: { label: "草稿", color: "default" },
    reviewing: { label: "审核中", color: "blue" },
    approved: { label: "已通过", color: "success" },
    rejected: { label: "已拒绝", color: "error" },
  };

  // 全局变更统计汇总
  const globalStats = useMemo(() => {
    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    let versionsWithDiff = 0;

    versions.forEach((v) => {
      const diff = parseDiffResult(v.diff_result);
      if (diff) {
        const added = diff.added_files?.length || 0;
        const modified = diff.modified_files?.length || 0;
        const removed = diff.removed_files?.length || 0;
        totalAdded += added;
        totalModified += modified;
        totalRemoved += removed;
        if (added > 0 || modified > 0 || removed > 0) {
          versionsWithDiff++;
        }
      }
    });

    return {
      totalVersions: versions.length,
      totalAdded,
      totalModified,
      totalRemoved,
      versionsWithDiff,
    };
  }, [versions]);

  // 渲染单个版本的差异详细卡片
  const renderVersionDiffContent = (_v: any, diff: any) => {
    if (!diff) {
      return (
        <div style={{ color: "#8c8c8c", padding: "8px 0" }}>
          🚀 初始版本创建 / 暂无与更早历史版本的差异对比记录
        </div>
      );
    }

    const added = diff.added_files || [];
    const removed = diff.removed_files || [];
    const modified = diff.modified_files || [];

    // 过滤搜索
    const keyword = searchKeyword.trim().toLowerCase();
    const filteredAdded = added.filter((file: string) =>
      !keyword || file.toLowerCase().includes(keyword)
    );
    const filteredRemoved = removed.filter((file: string) =>
      !keyword || file.toLowerCase().includes(keyword)
    );
    const filteredModified = modified.filter((item: any) => {
      if (!keyword) return true;
      if (item.file_path?.toLowerCase().includes(keyword)) return true;
      if (
        item.changes?.some(
          (c: any) =>
            c.before?.toLowerCase().includes(keyword) ||
            c.after?.toLowerCase().includes(keyword)
        )
      ) {
        return true;
      }
      return false;
    });

    const hasAny = filteredAdded.length > 0 || filteredRemoved.length > 0 || filteredModified.length > 0;

    if (!hasAny) {
      if (keyword) {
        return <div style={{ color: "#8c8c8c", padding: "8px 0" }}>未找到匹配关键词 "{keyword}" 的变更项</div>;
      }
      return <div style={{ color: "#8c8c8c", padding: "8px 0" }}>该版本与上一版本内容完全一致，无文件或页面文本改动</div>;
    }

    return (
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        {/* 新增页面 */}
        {(filterDiffType === "all" || filterDiffType === "added") && filteredAdded.length > 0 && (
          <div style={{ background: "rgba(82, 196, 26, 0.08)", border: "1px solid rgba(82, 196, 26, 0.3)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontWeight: 600, color: "#52c41a", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <PlusOutlined /> 新增页面 / 文件 ({filteredAdded.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {filteredAdded.map((file: string, idx: number) => (
                <Tag color="green" key={idx} style={{ padding: "2px 8px", fontSize: 13 }}>
                  + {file}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 移除页面 */}
        {(filterDiffType === "all" || filterDiffType === "removed") && filteredRemoved.length > 0 && (
          <div style={{ background: "rgba(255, 77, 79, 0.08)", border: "1px solid rgba(255, 77, 79, 0.3)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontWeight: 600, color: "#ff4d4f", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <MinusOutlined /> 移除 / 下线页面 ({filteredRemoved.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {filteredRemoved.map((file: string, idx: number) => (
                <Tag color="red" key={idx} style={{ textDecoration: "line-through", padding: "2px 8px", fontSize: 13 }}>
                  - {file}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 修改页面 */}
        {(filterDiffType === "all" || filterDiffType === "modified") && filteredModified.length > 0 && (
          <div style={{ background: "rgba(24, 144, 255, 0.08)", border: "1px solid rgba(24, 144, 255, 0.3)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontWeight: 600, color: "#1890ff", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <EditOutlined /> 修改页面与文本内容 ({filteredModified.length})
            </div>
            <Collapse
              size="small"
              ghost
              defaultActiveKey={filteredModified.slice(0, 3).map((_: any, i: number) => String(i))}
              items={filteredModified.map((item: any, itemIdx: number) => ({
                key: String(itemIdx),
                label: (
                  <Space>
                    <Text strong style={{ color: "#1890ff" }}>📄 {item.file_path}</Text>
                    <Badge count={item.changes?.length || 0} style={{ backgroundColor: "#52c41a" }} />
                  </Space>
                ),
                children: (
                  <div style={{ padding: "4px 0" }}>
                    {item.changes?.map((change: any, idx: number) => {
                      const diff = renderDiff(change.before || "", change.after || "");
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: 8,
                            borderLeft: "4px solid #1890ff",
                            backgroundColor: "rgba(128, 128, 128, 0.06)",
                            marginBottom: 8,
                            borderRadius: 4,
                            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                          }}
                        >
                          {change.before && (
                            <div
                              style={{
                                color: "#ff4d4f",
                                fontSize: 12,
                                marginBottom: 4,
                                fontFamily: "monospace",
                                whiteSpace: "pre-wrap",
                                backgroundColor: "rgba(255, 77, 79, 0.15)",
                                padding: "4px 8px",
                                borderRadius: 3,
                              }}
                            >
                              - {diff.prefix}
                              <span style={{ backgroundColor: "rgba(255, 77, 79, 0.35)", textDecoration: "line-through", fontWeight: 600 }}>
                                {diff.oldDiff}
                              </span>
                              {diff.suffix}
                            </div>
                          )}
                          <div
                            style={{
                              color: "#52c41a",
                              fontSize: 12,
                              fontFamily: "monospace",
                              whiteSpace: "pre-wrap",
                              backgroundColor: "rgba(82, 196, 26, 0.15)",
                              padding: "4px 8px",
                              borderRadius: 3,
                            }}
                          >
                            + {diff.prefix}
                            <span style={{ backgroundColor: "rgba(82, 196, 26, 0.35)", fontWeight: "bold" }}>
                              {diff.newDiff}
                            </span>
                            {diff.suffix}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ),
              }))}
            />
          </div>
        )}
      </Space>
    );
  };

  return (
    <Show
      isLoading={isLoading}
      headerButtons={() => (
        <Space>
          {latestVersion?.url && (
            <Button
              type="primary"
              icon={<GlobalOutlined />}
              onClick={() =>
                openPreview(
                  latestVersion.url,
                  `${record?.name} - ${latestVersion?.title || "最新版本"}`,
                )
              }
            >
              预览最新版本
            </Button>
          )}
          <Button
            icon={<PlusOutlined />}
            onClick={() => navigate(`/rp_prototype/create?project=${record?.id}`)}
          >
            新建/上传版本
          </Button>
          {isCreator && <EditButton recordItemId={record?.id} />}
        </Space>
      )}
    >
      {/* 项目基本信息卡片 */}
      <Card style={{ marginBottom: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
          {record?.cover && !record.cover.toLowerCase().endsWith(".svg") ? (
            <Image
              src={`${API_URL}/files/rp_project/${record?.id}/${record?.cover}?thumb=320x320`}
              preview={{
                src: `${API_URL}/files/rp_project/${record?.id}/${record?.cover}`,
              }}
              width={140}
              style={{ borderRadius: 8, objectFit: "cover" }}
            />
          ) : null}

          <div style={{ flex: 1, minWidth: 280 }}>
            <Title level={3} style={{ marginTop: 0, marginBottom: 12 }}>
              {record?.name}
            </Title>
            <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
              <Descriptions.Item label="创建人">
                {record?.expand?.creator?.email ||
                  record?.expand?.creator?.name ||
                  record?.creator ||
                  "-"}
              </Descriptions.Item>
              <Descriptions.Item label="最新活跃时间">
                <DateField
                  format="YYYY-MM-DD HH:mm:ss"
                  value={record?.folder_time || record?.updated || record?.created}
                />
              </Descriptions.Item>
              <Descriptions.Item label="版本总数">
                <Badge count={versions.length} showZero color="#1677ff" />
              </Descriptions.Item>
              {record?.description && (
                <Descriptions.Item label="项目描述 / 归档路径" span={3}>
                  <Text type="secondary">{record?.description}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          </div>
        </div>

        {/* 统计指标 */}
        <Divider style={{ margin: "16px 0 12px" }} />
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Statistic
              title="版本总数"
              value={globalStats.totalVersions}
              prefix={<AppstoreOutlined style={{ color: "#1890ff" }} />}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="累计新增页面"
              value={globalStats.totalAdded}
              valueStyle={{ color: "#3f8600" }}
              prefix={<FileAddOutlined />}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="累计修改页面"
              value={globalStats.totalModified}
              valueStyle={{ color: "#1890ff" }}
              prefix={<FileDoneOutlined />}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="累计下线页面"
              value={globalStats.totalRemoved}
              valueStyle={{ color: "#cf1322" }}
              prefix={<FileExcelOutlined />}
            />
          </Col>
        </Row>
      </Card>

      {/* 选项卡：全部变更时间线 / 单版本对比 / 版本历史列表 */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k)}
        type="card"
        items={[
          {
            key: "all-diffs",
            label: (
              <span>
                <ClockCircleOutlined /> 项目全部变更演进流 ({versions.length} 个版本)
              </span>
            ),
            children: (
              <Card>
                {/* 筛选与搜索工具栏 */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 24,
                    flexWrap: "wrap",
                    gap: 12,
                    backgroundColor: "#fafafa",
                    padding: "12px 16px",
                    borderRadius: 8,
                  }}
                >
                  <Space wrap size="middle">
                    <Input
                      placeholder="搜索页面名称或变更内容..."
                      prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
                      value={searchKeyword}
                      onChange={(e) => setSearchKeyword(e.target.value)}
                      allowClear
                      style={{ width: 260 }}
                    />
                    <Radio.Group
                      value={filterDiffType}
                      onChange={(e) => setFilterDiffType(e.target.value)}
                      buttonStyle="solid"
                    >
                      <Radio.Button value="all">全部变动</Radio.Button>
                      <Radio.Button value="added">仅看新增</Radio.Button>
                      <Radio.Button value="modified">仅看修改</Radio.Button>
                      <Radio.Button value="removed">仅看移除</Radio.Button>
                    </Radio.Group>
                  </Space>

                  <Text type="secondary">
                    从最新版本至初始版本的所有页面及内容变动明细
                  </Text>
                </div>

                {versions.length === 0 ? (
                  <Empty description="该项目暂无上传版本" />
                ) : (
                  <Timeline
                    mode="left"
                    items={versions.map((v, idx) => {
                      const diff = parseDiffResult(v.diff_result);
                      const isLatest = idx === 0;
                      const isInitial = idx === versions.length - 1;

                      return {
                        color: isLatest ? "green" : isInitial ? "blue" : "gray",
                        dot: isLatest ? (
                          <CheckCircleOutlined style={{ fontSize: 18, color: "#52c41a" }} />
                        ) : undefined,
                        children: (
                          <Card
                            size="small"
                            style={{
                              marginBottom: 20,
                              borderColor: isLatest ? "#b7eb8f" : "#f0f0f0",
                              boxShadow: isLatest ? "0 2px 8px rgba(82,196,26,0.12)" : "0 1px 3px rgba(0,0,0,0.03)",
                            }}
                            title={
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                                <Space align="center">
                                  <Text strong style={{ fontSize: 16 }}>
                                    {v.title || "未命名版本"}
                                  </Text>
                                  {isLatest && <Tag color="success">最新版本</Tag>}
                                  {isInitial && <Tag color="processing">初始版本</Tag>}
                                  {v.status && (
                                    <Tag color={statusMap[v.status]?.color || "default"}>
                                      {statusMap[v.status]?.label || v.status}
                                    </Tag>
                                  )}
                                </Space>
                                <Space>
                                  {v.url && (
                                    <Button
                                      size="small"
                                      type="primary"
                                      ghost
                                      icon={<GlobalOutlined />}
                                      onClick={() => openPreview(v.url, `${record?.name} - ${v.title}`)}
                                    >
                                      预览此版本
                                    </Button>
                                  )}
                                  <Button
                                    size="small"
                                    icon={<DiffOutlined />}
                                    onClick={() => {
                                      setSelectedVersionId(v.id);
                                      setActiveTab("single-diff");
                                    }}
                                  >
                                    单版本深度比对
                                  </Button>
                                </Space>
                              </div>
                            }
                            extra={
                              <Space split={<Divider type="vertical" />}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  👤 {v.expand?.creator?.email || v.expand?.creator?.name || v.creator || "-"}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  🕒 <DateField format="YYYY-MM-DD HH:mm:ss" value={v.created} />
                                </Text>
                              </Space>
                            }
                          >
                            {v.remark && (
                              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                                💬 备注说明：{v.remark}
                              </Paragraph>
                            )}

                            {renderVersionDiffContent(v, diff)}
                          </Card>
                        ),
                      };
                    })}
                  />
                )}
              </Card>
            ),
          },
          {
            key: "single-diff",
            label: (
              <span>
                <SwapOutlined /> 指定版本对比
              </span>
            ),
            children: (
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 20,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <Space align="center">
                    <Text strong>选择对比版本：</Text>
                    <Select
                      style={{ width: 280 }}
                      value={selectedVersionId}
                      onChange={(val) => setSelectedVersionId(val)}
                      options={versions.map((v, idx) => ({
                        value: v.id,
                        label: `${v.title || "未命名版本"} (${v.created?.slice(0, 10) || ""})${idx === 0 ? " [最新]" : ""}`,
                      }))}
                      placeholder="选择要查看差异的版本"
                    />
                    {selectedVersion?.url && (
                      <Button
                        size="small"
                        icon={<GlobalOutlined />}
                        onClick={() =>
                          openPreview(
                            selectedVersion.url,
                            `${record?.name} - ${selectedVersion?.title}`,
                          )
                        }
                      >
                        预览此版本
                      </Button>
                    )}
                  </Space>

                  <Text type="secondary">
                    * 对比当前所选版本与紧邻的前一个历史版本的差异
                  </Text>
                </div>

                <Divider style={{ margin: "12px 0 20px" }} />

                {selectedVersion ? (
                  renderVersionDiffContent(
                    selectedVersion,
                    parseDiffResult(selectedVersion.diff_result),
                  )
                ) : (
                  <Empty description="请选择要查看的版本" />
                )}
              </Card>
            ),
          },
          {
            key: "history",
            label: (
              <span>
                <HistoryOutlined /> 版本历史列表 ({versions.length})
              </span>
            ),
            children: (
              <Table
                dataSource={versions}
                rowKey="id"
                loading={loadingVersions}
                pagination={false}
              >
                <Table.Column
                  dataIndex="title"
                  title="版本标题"
                  width={300}
                  render={(value, item: any) => (
                    <Typography.Link
                      style={{
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                        minWidth: 220,
                        lineHeight: 1.5,
                        display: "inline-block",
                      }}
                      onClick={() => {
                        if (item.url) {
                          openPreview(item.url, `${record?.name} - ${item.title || "版本预览"}`);
                        }
                      }}
                    >
                      {value || "未命名版本"}
                    </Typography.Link>
                  )}
                />
                <Table.Column
                  dataIndex="status"
                  title="状态"
                  width={90}
                  align="center"
                  render={(value) => {
                    const status = statusMap[value] || { label: value, color: "default" };
                    return <Tag color={status.color}>{status.label}</Tag>;
                  }}
                />
                <Table.Column
                  dataIndex="remark"
                  title="备注"
                  render={(value) => (
                    <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, minWidth: 160 }}>
                      {value || "-"}
                    </div>
                  )}
                />
                <Table.Column
                  dataIndex="creator"
                  title="创建人"
                  width={180}
                  render={(value, item: any) => {
                    const creatorName = item?.expand?.creator?.email || item?.expand?.creator?.name || value || "-";
                    return (
                      <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4 }}>
                        {creatorName}
                      </div>
                    );
                  }}
                />
                <Table.Column
                  dataIndex="created"
                  title="上传/创建时间"
                  width={175}
                  render={(value) => (
                    <div style={{ whiteSpace: "nowrap", minWidth: 160 }}>
                      <DateField format="YYYY-MM-DD HH:mm:ss" value={value} />
                    </div>
                  )}
                />
                <Table.Column
                  title="操作"
                  dataIndex="actions"
                  width={200}
                  render={(_, item: any) => (
                    <Space split={<Divider type="vertical" />} size={0}>
                      {item.url && (
                        <Button
                          type="link"
                          size="middle"
                          icon={<GlobalOutlined />}
                          style={{ padding: "0 6px" }}
                          onClick={() =>
                            openPreview(item.url, `${record?.name} - ${item.title || "版本预览"}`)
                          }
                        >
                          预览
                        </Button>
                      )}
                      <Button
                        type="link"
                        size="middle"
                        icon={<DiffOutlined />}
                        style={{ padding: "0 6px" }}
                        onClick={() => {
                          setSelectedVersionId(item.id);
                          setActiveTab("single-diff");
                        }}
                      >
                        差异
                      </Button>
                      {item.file && (
                        <Tooltip title="下载原型压缩包">
                          <Button
                            type="link"
                            size="middle"
                            icon={<DownloadOutlined />}
                            style={{ padding: "0 6px" }}
                            href={`${API_URL}/files/rp_prototype/${item.id}/${item.file}`}
                            target="_blank"
                          >
                            下载
                          </Button>
                        </Tooltip>
                      )}
                    </Space>
                  )}
                />
              </Table>
            ),
          },
        ]}
      />

      {/* 原型预览抽屉 */}
      <Drawer
        title={drawerTitle}
        placement="right"
        width="85%"
        onClose={() => setPreviewUrl(null)}
        open={!!previewUrl}
        extra={
          <Button
            icon={<ExportOutlined />}
            onClick={() => previewUrl && window.open(previewUrl, "_blank")}
          >
            新窗口打开
          </Button>
        }
        styles={{ body: { padding: 0, overflow: "hidden" } }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            title="Prototype Preview"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        )}
      </Drawer>
    </Show>
  );
};
