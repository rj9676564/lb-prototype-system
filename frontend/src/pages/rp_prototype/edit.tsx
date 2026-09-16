import React, { useState } from "react";
import { Edit, useForm, useSelect } from "@refinedev/antd";
import { useInvalidate } from "@refinedev/core";
import { Form, Input, Select, message } from "antd";
import JSZip from "jszip";
import { PrototypeUploadZone, FileWithRelPath } from "../../components/PrototypeUploadZone";

export const PrototypeEdit = () => {
  const { formProps, saveButtonProps, query } = useForm<any>();
  const [messageApi, contextHolder] = message.useMessage();
  const invalidate = useInvalidate();

  const [uploadData, setUploadData] = useState<{
    mode: "folder" | "zip";
    folderFiles: FileWithRelPath[];
    zipFile: File | null;
  }>({
    mode: "folder",
    folderFiles: [],
    zipFile: null,
  });

  const [packaging, setPackaging] = useState(false);
  const [packingProgress, setPackingProgress] = useState<number | null>(null);
  const [packingText, setPackingText] = useState<string>("");

  const handleOnFinish = async (values: any) => {
    try {
      const { mode, folderFiles, zipFile } = uploadData;
      const hasNewFiles = (mode === "folder" && folderFiles.length > 0) || (mode === "zip" && !!zipFile);

      setPackaging(true);
      const formData = new FormData();
      Object.keys(values).forEach((key) => {
        if (key !== "file" && values[key] !== undefined && values[key] !== null) {
          formData.append(key, values[key]);
        }
      });

      if (hasNewFiles) {
        if (mode === "folder") {
          setPackingText(`正在打包 ${folderFiles.length} 个文件...`);
          setPackingProgress(5);

          const zip = new JSZip();
          for (const item of folderFiles) {
            zip.file(item.relativePath, item.file);
          }

          const blob = await zip.generateAsync(
            {
              type: "blob",
              compression: "DEFLATE",
              compressionOptions: { level: 6 },
            },
            (metadata) => {
              setPackingProgress(Math.round(metadata.percent));
              setPackingText(`正在打包文件 (${Math.round(metadata.percent)}%)...`);
            },
          );

          setPackingText("正在上传并提交至 Git 仓库...");
          const outputZipFile = new File([blob], `${values.title || "prototype"}.zip`, {
            type: "application/zip",
          });
          formData.append("file", outputZipFile);
        } else if (zipFile) {
          formData.append("file", zipFile);
        }
      }

      if (formProps.onFinish) {
        await formProps.onFinish(formData as any);
      }

      invalidate({ resource: "rp_project", invalidates: ["list", "many", "detail"] });
      invalidate({ resource: "rp_prototype", invalidates: ["list", "many", "detail"] });
    } catch (err: any) {
      messageApi.error("保存失败: " + (err?.message || "未知错误"));
    } finally {
      setPackaging(false);
      setPackingProgress(null);
    }
  };

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
    defaultValue: query?.data?.data?.field,
  });

  return (
    <Edit saveButtonProps={{ ...saveButtonProps, loading: packaging || saveButtonProps?.loading }}>
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
          <Input />
        </Form.Item>
        <Form.Item
          label="备注"
          name={["remark"]}
        >
          <Input.TextArea rows={2} placeholder="输入版本备注信息" />
        </Form.Item>

        <Form.Item label="更新原型文件 (不上传则保持原样)">
          <PrototypeUploadZone
            onFilesChange={setUploadData}
            packagingProgress={packingProgress}
            packagingText={packingText}
          />
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
    </Edit>
  );
};
