import React, { useState } from "react";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { useInvalidate } from "@refinedev/core";
import { Form, Input, Select, Upload, Button, Segmented, Space, Typography, Alert, message } from "antd";
import { FolderOpenOutlined, FileZipOutlined, InboxOutlined } from "@ant-design/icons";
import { useSearchParams, useNavigate } from "react-router";
import JSZip from "jszip";

const { Text } = Typography;

export const PrototypeCreate = () => {
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");
  const [messageApi, contextHolder] = message.useMessage();
  const invalidate = useInvalidate();
  const navigate = useNavigate();

  const { formProps, saveButtonProps, form } = useForm<any>({
    redirect: false,
  });
  const [uploadMode, setUploadMode] = useState<"folder" | "zip">("folder");
  const [folderFiles, setFolderFiles] = useState<any[]>([]);
  const [zipFiles, setZipFiles] = useState<any[]>([]);
  const [packaging, setPackaging] = useState(false);

  React.useEffect(() => {
    if (projectIdFromUrl) {
      form.setFieldsValue({
        project: projectIdFromUrl,
        status: "approved",
      });
    } else {
      form.setFieldsValue({
        status: "approved",
      });
    }
  }, [projectIdFromUrl, form]);

  const handleOnFinish = async (values: any) => {
    try {
      const formData = new FormData();
      Object.keys(values).forEach((key) => {
        if (key !== "file" && values[key] !== undefined && values[key] !== null) {
          formData.append(key, values[key]);
        }
      });

      if (uploadMode === "folder") {
        if (folderFiles.length === 0) {
          messageApi.error("请选择或拖入原型文件夹！");
          return;
        }

        setPackaging(true);
        messageApi.loading({ content: `正在快速打包 ${folderFiles.length} 个原型文件...`, key: "packing", duration: 0 });

        const zip = new JSZip();
        for (const item of folderFiles) {
          const file = item.originFileObj as File;
          if (!file) continue;
          let relPath = file.webkitRelativePath || file.name;
          const parts = relPath.split("/");
          if (parts.length > 1) {
            relPath = parts.slice(1).join("/");
          }
          zip.file(relPath, file);
        }

        const blob = await zip.generateAsync({ type: "blob" });
        const zipFile = new File([blob], `${values.title || "prototype"}.zip`, { type: "application/zip" });
        formData.append("file", zipFile);
        messageApi.success({ content: "打包完成，正在上传并提交至 Git 仓库...", key: "packing", duration: 3 });
      } else {
        if (zipFiles.length > 0 && zipFiles[0]?.originFileObj) {
          formData.append("file", zipFiles[0].originFileObj);
        }
      }

      if (formProps.onFinish) {
        await formProps.onFinish(formData as any);
      }

      // 级联刷新项目列表和版本列表缓存
      invalidate({ resource: "rp_project", invalidates: ["list", "many", "detail"] });
      invalidate({ resource: "rp_prototype", invalidates: ["list", "many", "detail"] });

      messageApi.success("版本创建成功！正在返回并刷新项目列表...");
      setTimeout(() => {
        navigate("/rp_project");
      }, 600);
    } catch (err: any) {
      messageApi.error("提交失败: " + (err?.message || "未知错误"));
    } finally {
      setPackaging(false);
    }
  };

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
  });

  const totalFolderSize = folderFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const totalFolderSizeMB = (totalFolderSize / (1024 * 1024)).toFixed(2);

  return (
    <Create saveButtonProps={{ ...saveButtonProps, loading: packaging || saveButtonProps?.loading }}>
      {contextHolder}
      <Form {...formProps} onFinish={handleOnFinish} layout="vertical">
        <Form.Item
          label="所属项目"
          name={["project"]}
          rules={[{ required: true, message: "请选择所属项目！" }]}
        >
          <Select {...projectSelectProps} placeholder="选择项目" />
        </Form.Item>
        <Form.Item
          label="版本标题"
          name={["title"]}
          rules={[{ required: true, message: "请输入版本标题！" }]}
        >
          <Input placeholder="例如：扫码点餐v1.04需求" />
        </Form.Item>
        <Form.Item
          label="备注"
          name={["remark"]}
        >
          <Input.TextArea rows={2} placeholder="输入版本备注信息（可选）" />
        </Form.Item>

        <Form.Item label="原型文件上传" required>
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Segmented
              value={uploadMode}
              onChange={(val) => setUploadMode(val as "folder" | "zip")}
              options={[
                { label: "选择整个文件夹 (推荐)", value: "folder", icon: <FolderOpenOutlined /> },
                { label: "上传 ZIP 压缩包", value: "zip", icon: <FileZipOutlined /> },
              ]}
            />

            {uploadMode === "folder" ? (
              <Upload.Dragger
                directory
                multiple
                beforeUpload={() => false}
                fileList={folderFiles}
                onChange={({ fileList }) => setFolderFiles(fileList)}
                showUploadList={{ showRemoveIcon: true }}
                maxCount={2000}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击选择或将整个 Axure 导出的原型文件夹拖拽至此处</p>
                <p className="ant-upload-hint">
                  系统会自动保留目录结构并在本地快速打包上传
                </p>
                {folderFiles.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="success">
                      已选文件夹包含 {folderFiles.length} 个文件（共约 {totalFolderSizeMB} MB）
                    </Text>
                  </div>
                )}
              </Upload.Dragger>
            ) : (
              <Upload.Dragger
                beforeUpload={() => false}
                maxCount={1}
                accept=".zip,application/zip,application/x-zip-compressed"
                fileList={zipFiles}
                onChange={({ fileList }) => setZipFiles(fileList)}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或将 ZIP 压缩包拖拽至此处</p>
                <p className="ant-upload-hint">
                  支持 Axure 打包生成的 .zip 压缩包
                </p>
              </Upload.Dragger>
            )}

            <Alert
              type="info"
              showIcon
              message="自动归档与 Git 提交"
              description="上传成功后，系统将自动按「当前年月 / 项目名 / 版本标题」归档写入 Git 仓库，并自动执行 Git Commit & Push。"
            />
          </Space>
        </Form.Item>

        <Form.Item
          label="状态"
          name={["status"]}
        >
          <Select
            options={[
              { label: "已通过", value: "approved" },
              { label: "草稿", value: "draft" },
              { label: "审核中", value: "reviewing" },
              { label: "已拒绝", value: "rejected" },
            ]}
          />
        </Form.Item>
      </Form>
    </Create>
  );
};
