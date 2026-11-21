import React from "react";
import {
  List,
  useTable,
  DeleteButton,
  DateField,
} from "@refinedev/antd";
import { Table, Space, Avatar, Button, Form, Input, message, Tooltip, Drawer, Flex, Modal, Divider, Typography, Tag, Select } from "antd";
import { EyeOutlined, SearchOutlined, SyncOutlined, GlobalOutlined, ExportOutlined, FileMarkdownOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import { MarkdownView } from "../../components/MarkdownView";
import { ProjectDocsTab } from "../../components/ProjectDocsTab";
import { pb } from "../../lib/pocketbase";
import { API_URL, BASE_URL } from "../../providers/constants";
import { DEFAULT_PROJECT_STATUS, projectStatusOptions, ProjectStatusTag } from "./status";

type LatestPrototypeMeta = {
  title?: string;
  url?: string;
  updated?: string;
};

export const ProjectList = () => {
  const { data: user } = useGetIdentity<any>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get("status");
  const status = urlStatus && (urlStatus === "all" || projectStatusOptions.some((option) => option.value === urlStatus))
    ? urlStatus
    : DEFAULT_PROJECT_STATUS;
  const [messageApi, contextHolder] = message.useMessage();
  const [syncing, setSyncing] = React.useState(false);
  const [mdPreview, setMdPreview] = React.useState<{ title: string; content: string } | null>(null);
  const [latestPrototypeMap, setLatestPrototypeMap] = React.useState<Record<string, LatestPrototypeMeta>>({});
  const [docCountMap, setDocCountMap] = React.useState<Record<string, number>>({});
  const [docsDrawerProject, setDocsDrawerProject] = React.useState<{ id: string; name: string } | null>(null);

  const { tableProps, searchFormProps, tableQuery, setFilters, setCurrentPage } = useTable({
    syncWithLocation: false,
    filters: {
      initial: [{ field: "status", operator: "eq", value: status === "all" ? "" : status }],
    },
    pagination: {
      pageSize: 50,
    },
    sorters: {
      initial: [
        {
          field: "folder_time",
          order: "desc",
        },
      ],
    },
    onSearch: (values: any) => {
      return [
        {
          field: "q",
          operator: "contains",
          value: values.keyword,
        },
      ];
    },
  });

  React.useEffect(() => {
    setFilters([{ field: "status", operator: "eq", value: status === "all" ? "" : status }], "merge");
    setCurrentPage(1);
  }, [status, setFilters, setCurrentPage]);

  const projectIdsKey = (tableProps?.dataSource?.map((item: any) => item?.id).filter(Boolean) ?? []).join(",");

  React.useEffect(() => {
    const projectIds = projectIdsKey ? projectIdsKey.split(",") : [];

    if (projectIds.length === 0) {
      setLatestPrototypeMap({});
      setDocCountMap({});
      return;
    }

    let cancelled = false;

    const loadLatestPrototypes = async () => {
      try {
        const filter = projectIds.map((id) => `project = "${id}"`).join(" || ");
        const [protoRes, docsRes] = await Promise.all([
          pb.collection("rp_prototype").getList<any>(1, 200, {
            filter,
            sort: "-created",
          }),
          pb.collection("rp_project_doc").getList<any>(1, 500, {
            filter,
            fields: "id,project",
          }),
        ]);

        if (cancelled) return;

        const map: Record<string, LatestPrototypeMeta> = {};
        for (const item of protoRes.items || []) {
          if (item.project && !map[item.project]) {
            map[item.project] = {
              title: item.title,
              url: item.url,
              updated: item.updated,
            };
          }
        }

        const counts: Record<string, number> = {};
        for (const doc of docsRes.items || []) {
          if (doc.project) {
            counts[doc.project] = (counts[doc.project] || 0) + 1;
          }
        }

        setLatestPrototypeMap(map);
        setDocCountMap(counts);
      } catch {
        if (!cancelled) {
          setLatestPrototypeMap({});
          setDocCountMap({});
        }
      }
    };

    loadLatestPrototypes();

    return () => {
      cancelled = true;
    };
  }, [projectIdsKey]);

  const handleScanImport = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${API_URL}/prototype-sync/scan`, {
        method: "POST",
        headers: {
          Authorization: pb.authStore.token ? `Bearer ${pb.authStore.token}` : "",
        },
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.message || result?.data?.message || "扫描导入失败");
      }

      const skippedPaths: string[] = Array.isArray(result.skipped_paths) ? result.skipped_paths : [];
      const skippedCount = skippedPaths.length;

      const scannedCount = result.scanned_projects ?? 0;
      const syncedCount = result.synced_projects ?? 0;
      const deletedCount = result.deleted_projects ?? 0;
      const deletedMsg = deletedCount > 0 ? `，移除下架 ${deletedCount} 个` : "";
      const unsyncedCount = Math.max(scannedCount - syncedCount, skippedCount);

      await messageApi.success(
        `扫描完成：发现 ${scannedCount} 个候选项目，成功同步 ${syncedCount} 个（新增 ${result.created_projects ?? 0}，更新 ${result.updated_projects ?? 0}${deletedMsg}），未同步 ${unsyncedCount} 个。`,
      );

      if (skippedCount > 0) {
        Modal.warning({
          title: "部分项目导入失败",
          width: 760,
          content: (
            <div style={{ maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {skippedPaths.join("\n")}
            </div>
          ),
        });
      }

      searchFormProps.form?.resetFields();
      await tableQuery.refetch();
    } catch (error: any) {
      messageApi.error(error?.message || "扫描导入失败");
    } finally {
      setSyncing(false);
    }
  };

  const launchProject = (record: any) => {
    window.open(record.url, "_blank", "noopener,noreferrer");
  };

  const openPreview = (url: string, _title: string, updated?: string) => {
    const fullUrl = url.startsWith("/") ? `${BASE_URL}${url}` : url;
    const separator = fullUrl.includes("?") ? "&" : "?";
    const version = updated ? encodeURIComponent(updated) : new Date().getTime().toString();
    const busterUrl = `${fullUrl}${separator}v=${version}`;
    window.open(busterUrl, "_blank", "noopener,noreferrer");
  };

  const handleProjectNameClick = (record: any) => {
    if (record.source_type === "markdown") {
      setMdPreview({ title: record.name, content: record.markdown || "" });
      return;
    }
    if (record.source_type === "url" && record.url) {
      launchProject(record);
      return;
    }
    const latestPrototype = latestPrototypeMap[record.id];
    if (latestPrototype?.url) {
      openPreview(
        latestPrototype.url,
        `${record.name} - ${latestPrototype.title || "最新版本"}`,
        latestPrototype.updated,
      );
      return;
    }
    navigate(`/rp_project/show/${record.id}`);
  };

  return (
    <List headerButtons={user ? undefined : false}>
      {contextHolder}
      <Form
        {...searchFormProps}
        layout="inline"
        style={{ marginBottom: "1rem" }}
      >
        <Form.Item name="keyword">
          <Input placeholder="检索项目名称/项目描述/创建人邮箱" prefix={<SearchOutlined />} style={{ width: 300 }} />
        </Form.Item>
        <Form.Item label="项目状态">
          <Select
            aria-label="项目状态"
            value={status}
            options={[{ label: "全部状态", value: "all" }, ...projectStatusOptions]}
            onChange={(value) => {
              const params = new URLSearchParams(searchParams);
              params.set("status", value);
              setSearchParams(params);
            }}
            style={{ width: 110 }}
          />
        </Form.Item>
        <Flex gap="small">
          <Button type="primary" htmlType="submit">
            搜索
          </Button>
          {user && (
            <Button icon={<SyncOutlined />} loading={syncing} onClick={handleScanImport}>
              扫描导入
            </Button>
          )}
        </Flex>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="cover"
          title="封面"
          width={96}
          align="center"
          render={(value, record: any) =>
            value && typeof value === "string" && !value.toLowerCase().endsWith(".svg") ? (
              <Avatar
                src={`${API_URL}/files/rp_project/${record.id}/${value}?thumb=160x160`}
                shape="square"
                size={72}
              />
            ) : null
          }
        />
        <Table.Column
          dataIndex="name"
          title="项目名称"
          width={260}
          render={(value, record: any) => (
            <Typography.Link
              style={{
                whiteSpace: "normal",
                wordBreak: "break-word",
                minWidth: 200,
                lineHeight: 1.5,
                display: "inline-block",
              }}
              onClick={() => handleProjectNameClick(record)}
            >
              {value}
            </Typography.Link>
          )}
        />
        <Table.Column
          dataIndex="source_type"
          title="类型"
          width={100}
          render={(value) =>
            value === "url" ? (
              <Tag color="purple">URL</Tag>
            ) : value === "markdown" ? (
              <Tag color="green">Markdown</Tag>
            ) : value === "auto" ? (
              <Tag color="blue">Git 同步</Tag>
            ) : (
              <Tag>本地上传</Tag>
            )
          }
        />
        <Table.Column
          dataIndex="status"
          title="项目状态"
          width={100}
          render={(value) => <ProjectStatusTag status={value} />}
        />
        <Table.Column
          dataIndex="description"
          title="项目描述"
          render={(value) => (
            <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4, minWidth: 180 }}>
              {value || "-"}
            </div>
          )}
        />
        <Table.Column
          dataIndex="created"
          title="创建时间"
          width={175}
          sorter
          render={(value) => (
            <div style={{ whiteSpace: "nowrap", minWidth: 160 }}>
              <DateField format="YYYY-MM-DD HH:mm:ss" value={value} />
            </div>
          )}
        />
        <Table.Column
          dataIndex="updated"
          title="更新时间"
          width={175}
          sorter
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
          render={(_, record: any) => {
            const isCreator = user?.id === record.creator;
            const latestPrototype = latestPrototypeMap[record.id];
            return (
              <Space split={<Divider type="vertical" />} size={0} style={{ whiteSpace: "nowrap" }}>
                {record.source_type === "markdown" && (
                  <Tooltip title="快速抽屉预览 Markdown 内容">
                    <Button
                      type="link"
                      size="middle"
                      icon={<GlobalOutlined />}
                      style={{ padding: "0 6px" }}
                      onClick={() => setMdPreview({ title: record.name, content: record.markdown || "" })}
                    >
                      预览
                    </Button>
                  </Tooltip>
                )}
                {record.source_type === "url" && record.url && (
                  <Button
                    type="link"
                    size="middle"
                    icon={<ExportOutlined />}
                    style={{ padding: "0 6px" }}
                    onClick={() => launchProject(record)}
                  >
                    启动
                  </Button>
                )}
                {latestPrototype?.url && (
                  <Tooltip title="快速抽屉预览最新原型">
                    <Button
                      type="link"
                      size="middle"
                      icon={<GlobalOutlined />}
                      style={{ padding: "0 6px" }}
                      onClick={() => {
                        openPreview(
                          latestPrototype.url!,
                          `${record.name} - ${latestPrototype.title || "最新版本"}`,
                          latestPrototype.updated,
                        );
                      }}
                    >
                      预览
                    </Button>
                  </Tooltip>
                )}
                {docCountMap[record.id] > 0 && (
                  <Button
                    type="link"
                    size="middle"
                    icon={<FileMarkdownOutlined />}
                    style={{ padding: "0 6px" }}
                    onClick={() => setDocsDrawerProject({ id: record.id, name: record.name })}
                  >
                    {`文档(${docCountMap[record.id]})`}
                  </Button>
                )}
                <Button
                  type="link"
                  size="middle"
                  icon={<EyeOutlined />}
                  style={{ padding: "0 6px" }}
                  onClick={() => navigate(`/rp_project/show/${record.id}`)}
                >
                  详情
                </Button>
                {isCreator && (
                  <DeleteButton
                    type="link"
                    size="middle"
                    recordItemId={record.id}
                    style={{ padding: "0 6px" }}
                  />
                )}
              </Space>
            );
          }}
        />
      </Table>

      <Drawer
        title={mdPreview?.title}
        placement="right"
        width="70%"
        onClose={() => setMdPreview(null)}
        open={!!mdPreview}
        destroyOnClose
      >
        {mdPreview && <MarkdownView content={mdPreview.content} />}
      </Drawer>

      <Drawer
        title={docsDrawerProject ? `${docsDrawerProject.name} - 联调文档与备注` : "联调文档与备注"}
        placement="right"
        width="80%"
        onClose={() => setDocsDrawerProject(null)}
        open={!!docsDrawerProject}
        destroyOnClose
      >
        {docsDrawerProject && (
          <ProjectDocsTab
            projectId={docsDrawerProject.id}
            projectName={docsDrawerProject.name}
            currentUserId={user?.id}
            onCountChange={(count) =>
              setDocCountMap((prev) => ({
                ...prev,
                [docsDrawerProject.id]: count,
              }))
            }
          />
        )}
      </Drawer>
    </List>
  );
};
