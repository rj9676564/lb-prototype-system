import React, { useMemo } from "react";
import { useShow, useOne } from "@refinedev/core";
import { Show, TextField, DateField, UrlField } from "@refinedev/antd";
import { Typography, Button, Divider, List, Badge, Space, Empty } from "antd";
import { DownloadOutlined, PlusOutlined, MinusOutlined, EditOutlined, ExportOutlined } from "@ant-design/icons";
import { BASE_URL, API_URL } from "../../providers/constants";

const { Title } = Typography;

export const PrototypeShow = () => {
  const { query } = useShow({});
  const { data, isLoading } = query;
  const record = data?.data;

  const { query: projectQuery } = useOne({
    resource: "rp_project",
    id: record?.project || "",
    queryOptions: {
      enabled: !!record?.project,
    },
  });
  const projectData = projectQuery.data;
  const projectIsLoading = projectQuery.isLoading;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>ID</Title>
      <TextField value={record?.id} />
      
      <Title level={5}>所属项目</Title>
      {projectIsLoading ? <span>加载中...</span> : <TextField value={projectData?.data?.name || "-"} />}

      <Title level={5}>版本标题</Title>
      <TextField value={record?.title} />
      
      <Title level={5}>备注</Title>
      <TextField value={record?.remark || "-"} />
      
      <Title level={5}>原型链接</Title>
      <Space direction="vertical" style={{ width: '100%' }}>
        <UrlField 
          value={record?.url?.startsWith('/') ? `${BASE_URL}${record.url}` : record?.url} 
          target="_blank" 
        />
        {record?.url && (
          <div style={{ 
            width: '100%', 
            height: '600px', 
            border: '1px solid #d9d9d9', 
            borderRadius: '8px', 
            overflow: 'hidden', 
            position: 'relative',
            marginTop: '8px',
            backgroundColor: '#f5f5f5'
          }}>
            <iframe 
              src={record?.url?.startsWith('/') ? `${BASE_URL}${record.url}` : record?.url} 
              style={{ width: '100%', height: '100%', border: 'none' }} 
              title="Prototype Preview"
            />
            <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10 }}>
              <Button 
                type="primary" 
                icon={<ExportOutlined />} 
                onClick={() => {
                  const fullUrl = record?.url?.startsWith('/') 
                    ? `${BASE_URL}${record.url}` 
                    : record?.url;
                  window.open(fullUrl, "_blank");
                }}
                size="middle"
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
              >
                新窗口打开
              </Button>
            </div>
          </div>
        )}
      </Space>

      <Title level={5}>原型压缩包下载</Title>
      {record?.file ? (
        <Button 
          type="primary" 
          icon={<DownloadOutlined />} 
          href={`${API_URL}/files/rp_prototype/${record?.id}/${record?.file}`} 
          target="_blank"
        >
          下载 ZIP
        </Button>
      ) : (
        <Typography.Text type="secondary">未上传</Typography.Text>
      )}

      <Title level={5}>状态</Title>
      <TextField value={
        {
          draft: "草稿",
          reviewing: "审核中",
          approved: "已通过",
          rejected: "已拒绝",
        }[record?.status as string] || record?.status
      } />

      <Divider />
      <Title level={4}>版本差异对比</Title>
      {record?.diff_result ? (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 新增文件 */}
          {record.diff_result.added_files?.length > 0 && (
            <List
              header={<div><Badge status="success" text="新增文件" /><PlusOutlined style={{ float: 'right', color: '#52c41a' }} /></div>}
              bordered
              dataSource={record.diff_result.added_files}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          )}
          
          {/* 移除文件 */}
          {record.diff_result.removed_files?.length > 0 && (
            <List
              header={<div><Badge status="error" text="移出文件" /><MinusOutlined style={{ float: 'right', color: '#ff4d4f' }} /></div>}
              bordered
              dataSource={record.diff_result.removed_files}
              renderItem={(item: string) => <List.Item style={{ textDecoration: 'line-through', color: '#ff4d4f' }}>{item}</List.Item>}
            />
          )}

          {/* 内容变更 */}
          {record.diff_result.modified_files?.length > 0 && (
            <List
              header={<div><Badge status="processing" text="内容变更" /><EditOutlined style={{ float: 'right', color: '#1890ff' }} /></div>}
              bordered
              dataSource={record.diff_result.modified_files}
              renderItem={(item: any) => {
                return (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: '8px' }}>
                        {item.file_path}
                      </Typography.Text>
                      {item.changes?.map((change: any, idx: number) => {
                        // 简单的字符级差异高亮实现
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
                            newStr.length - pref
                          );
                          
                          return {
                            prefix: oldStr.slice(0, pref),
                            oldDiff: oldStr.slice(pref, oldStr.length - suff),
                            newDiff: newStr.slice(pref, newStr.length - suff),
                            suffix: oldStr.slice(oldStr.length - suff)
                          };
                        };

                        const diff = renderDiff(change.before || "", change.after || "");

                        return (
                          <div key={idx} style={{ 
                            padding: '8px', 
                            borderLeft: '4px solid #1890ff', 
                            backgroundColor: '#f9f9f9',
                            marginBottom: '8px',
                            borderRadius: '2px'
                          }}>
                            {change.before && (
                              <div style={{ 
                                color: '#cf1322', 
                                fontSize: '12px',
                                marginBottom: '4px',
                                fontFamily: 'monospace',
                                whiteSpace: 'pre-wrap',
                                backgroundColor: '#fff1f0',
                                padding: '2px 4px'
                              }}>
                                - {diff.prefix}
                                <span style={{ backgroundColor: '#ffa39e', textDecoration: 'line-through' }}>{diff.oldDiff}</span>
                                {diff.suffix}
                              </div>
                            )}
                            <div style={{ 
                              color: '#389e0d', 
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              whiteSpace: 'pre-wrap',
                              backgroundColor: '#f6ffed',
                              padding: '2px 4px'
                            }}>
                              + {diff.prefix}
                              <span style={{ backgroundColor: '#b7eb8f', fontWeight: 'bold' }}>{diff.newDiff}</span>
                              {diff.suffix}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Space>
      ) : (
        <Empty description="暂无差异结果" />
      )}
      
      <Title level={5}>创建时间</Title>
      <DateField format="YYYY-MM-DD HH:mm:ss" value={record?.created} />
    </Show>
  );
};
