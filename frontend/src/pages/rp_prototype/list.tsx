import React from "react";
import {
  List,
  useTable,
  EditButton,
  ShowButton,
  DeleteButton,
  DateField,
  useSelect,
  CreateButton,
} from "@refinedev/antd";
import { Table, Space, Tag, Button, Tooltip, Form, Select, Drawer, Flex, Divider, Typography } from "antd";
import { GlobalOutlined, SearchOutlined, ExportOutlined, EyeOutlined, ProjectOutlined } from "@ant-design/icons";
import { useGetIdentity } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import { BASE_URL } from "../../providers/constants";

export const PrototypeList = () => {
  const { data: user } = useGetIdentity<any>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // 预览相关的状态
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [drawerTitle, setDrawerTitle] = React.useState<string>("");

  const { tableProps, filters, searchFormProps } = useTable({
    syncWithLocation: true,
    pagination: {
      pageSize: 50,
    },
    onSearch: (values: any) => {
      return [
        {
          field: "project",
          operator: "eq",
          value: values.project,
        },
      ];
    },
    sorters: {
      initial: [
        {
          field: "created",
          order: "desc",
        },
      ],
    },
  });

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
  });

  const projectMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const opt of (projectSelectProps?.options as any[]) || []) {
      if (opt?.value) {
        map[opt.value] = opt.label;
      }
    }
    return map;
  }, [projectSelectProps?.options]);

  const projectFilter = filters?.find((f: any) => f.field === "project" && f.operator === "eq");
  // 优先从 URL 的 project 参数获取，其次从 filters，最后尝试解析 filters[0][value] 这种原始 URL 结构
  const filteredProjectId = searchParams.get("project") || 
                         (projectFilter as any)?.value || 
                         searchParams.get("filters[0][value]");

  return (
    <List 
      headerButtons={
        <CreateButton 
          resource="rp_prototype" 
          onClick={() => {
            const url = `/rp_prototype/create${filteredProjectId ? `?project=${filteredProjectId}` : ""}`;
            navigate(url);
          }}
        />
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: "1rem" }}>
        <Form.Item name="project" label="筛选项目">
          <Select
            {...projectSelectProps}
            placeholder="全部项目"
            allowClear
            style={{ width: 200 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
          查询
        </Button>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="title"
          title="版本标题"
          width={340}
          render={(value, record: any) => (
            <Typography.Link
              style={{
                whiteSpace: "normal",
                wordBreak: "break-word",
                minWidth: 280,
                lineHeight: 1.5,
                display: "inline-block",
              }}
              onClick={() => {
                if (record.url) {
                  const fullUrl = record.url.startsWith('/') 
                    ? `${BASE_URL}${record.url}` 
                    : record.url;
                  const separator = fullUrl.includes("?") ? "&" : "?";
                  const version = record.updated ? encodeURIComponent(record.updated) : new Date().getTime().toString();
                  const busterUrl = `${fullUrl}${separator}v=${version}`;
                  setPreviewUrl(busterUrl);
                  setDrawerTitle(record.title);
                } else {
                  navigate(`/rp_prototype/show/${record.id}`);
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
            const statusMap: Record<string, { label: string; color: string }> = {
              draft: { label: "草稿", color: "default" },
              reviewing: { label: "审核中", color: "blue" },
              approved: { label: "已通过", color: "success" },
              rejected: { label: "已拒绝", color: "error" },
            };
            const status = statusMap[value] || { label: value, color: "default" };
            return <Tag color={status.color}>{status.label}</Tag>;
          }}
        />
        <Table.Column
          dataIndex={["project"]}
          title="所属项目"
          width={240}
          render={(value, record: any) => {
            const projectName = record?.expand?.project?.name || projectMap[value] || value || "-";
            const projectId = record?.project || value;
            if (projectId) {
              return (
                <Typography.Link
                  style={{
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    minWidth: 180,
                    lineHeight: 1.4,
                    display: "inline-block",
                  }}
                  onClick={() => navigate(`/rp_project/show/${projectId}`)}
                >
                  {projectName}
                </Typography.Link>
              );
            }
            return projectName;
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
          render={(value, record: any) => {
            const creatorName = record?.expand?.creator?.email || record?.expand?.creator?.name || value || "-";
            return (
              <div style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.4 }}>
                {creatorName}
              </div>
            );
          }}
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
          title="操作"
          dataIndex="actions"
          width={200}
          render={(_, record: any) => {
            const isCreator = user?.id === record.creator;
            const projectId = record?.project;
            return (
              <Flex vertical gap={2} style={{ whiteSpace: "nowrap" }}>
                {/* 第一行：查看与预览 */}
                <Space split={<Divider type="vertical" />} size={0}>
                  {record.url && (
                    <Tooltip title="快速抽屉预览原型">
                      <Button
                        type="link"
                        size="middle"
                        icon={<GlobalOutlined />}
                        style={{ padding: "0 6px" }}
                        onClick={() => {
                          const fullUrl = record.url.startsWith('/') 
                            ? `${BASE_URL}${record.url}` 
                            : record.url;
                          const separator = fullUrl.includes("?") ? "&" : "?";
                          const version = record.updated ? encodeURIComponent(record.updated) : new Date().getTime().toString();
                          const busterUrl = `${fullUrl}${separator}v=${version}`;
                          setPreviewUrl(busterUrl);
                          setDrawerTitle(record.title);
                        }}
                      >
                        预览
                      </Button>
                    </Tooltip>
                  )}
                  <Button
                    type="link"
                    size="middle"
                    icon={<EyeOutlined />}
                    style={{ padding: "0 6px" }}
                    onClick={() => navigate(`/rp_prototype/show/${record.id}`)}
                  >
                    详情
                  </Button>
                  {projectId && (
                    <Tooltip title="查看所属项目全量演进">
                      <Button
                        type="link"
                        size="middle"
                        icon={<ProjectOutlined />}
                        style={{ padding: "0 6px" }}
                        onClick={() => navigate(`/rp_project/show/${projectId}`)}
                      >
                        项目
                      </Button>
                    </Tooltip>
                  )}
                </Space>

                {/* 第二行：管理与维护 */}
                {isCreator && (
                  <Space split={<Divider type="vertical" />} size={0}>
                    <EditButton
                      type="link"
                      size="middle"
                      recordItemId={record.id}
                      style={{ padding: "0 6px" }}
                    />
                    <DeleteButton
                      type="link"
                      size="middle"
                      recordItemId={record.id}
                      style={{ padding: "0 6px" }}
                    />
                  </Space>
                )}
              </Flex>
            );
          }}
        />
      </Table>

      {/* 侧边预览抽屉 */}
      <Drawer
        title={drawerTitle}
        placement="right"
        width="80%"
        onClose={() => setPreviewUrl(null)}
        open={!!previewUrl}
        extra={
          <Button 
            icon={<ExportOutlined />} 
            onClick={() => window.open(previewUrl!, "_blank")}
          >
            新窗口打开
          </Button>
        }
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            title="Prototype Preview"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        )}
      </Drawer>
    </List>
  );
};
