import React, { useState } from "react";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { useInvalidate } from "@refinedev/core";
import { Form, Input, Select, message } from "antd";
import { useSearchParams, useNavigate } from "react-router";
import JSZip from "jszip";
import { PrototypeUploadZone, FileWithRelPath } from "../../components/PrototypeUploadZone";

export const PrototypeCreate = () => {
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");
  const [messageApi, contextHolder] = message.useMessage();
  const invalidate = useInvalidate();
  const navigate = useNavigate();

  const { formProps, saveButtonProps, form } = useForm<any>({
    redirect: false,
  });

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
      const { mode, folderFiles, zipFile } = uploadData;

      if (mode === "folder") {
        if (!folderFiles || folderFiles.length === 0) {
          messageApi.error("请选择或拖入原型文件夹！");
          return;
        }
      } else {
        if (!zipFile) {
          messageApi.error("请选择或拖入 ZIP 压缩包！");
          return;
        }
      }

      setPackaging(true);
      const formData = new FormData();
      Object.keys(values).forEach((key) => {
        if (key !== "file" && values[key] !== undefined && values[key] !== null) {
          formData.append(key, values[key]);
        }
      });

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
      } else {
        if (zipFile) {
          formData.append("file", zipFile);
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
      setPackingProgress(null);
    }
  };

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
  });

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
    </Create>
  );
};
