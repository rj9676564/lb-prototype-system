import React from "react";
import { Create, useForm, useSelect } from "@refinedev/antd";
import { Form, Input, Select, Upload, Button } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router";

export const PrototypeCreate = () => {
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");
  
  const { formProps, saveButtonProps, form } = useForm<any>();

  React.useEffect(() => {
    if (projectIdFromUrl) {
      form.setFieldsValue({
        project: projectIdFromUrl,
        status: "draft",
      });
    } else {
      form.setFieldsValue({
        status: "draft",
      });
    }
  }, [projectIdFromUrl, form]);

  const handleOnFinish = (values: any) => {
    const formData = new FormData();
    Object.keys(values).forEach((key) => {
      if (key === "file") {
        if (values.file?.[0]?.originFileObj) {
          formData.append("file", values.file[0].originFileObj);
        }
      } else if (values[key] !== undefined && values[key] !== null) {
        formData.append(key, values[key]);
      }
    });

    if (formProps.onFinish) {
      formProps.onFinish(formData as any);
    }
  };

  const getValueFromEvent = (e: any) => {
    if (Array.isArray(e)) {
      return e;
    }
    return e?.fileList || [];
  };

  const { selectProps: projectSelectProps } = useSelect({
    resource: "rp_project",
    optionLabel: "name",
    optionValue: "id",
  });

  return (
    <Create saveButtonProps={saveButtonProps}>
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
        <Form.Item
          label="原型压缩包 (ZIP)"
          valuePropName="fileList"
          getValueFromEvent={getValueFromEvent}
          name="file"
        >
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            accept=".zip,application/zip,application/x-zip-compressed"
          >
            <Button icon={<UploadOutlined />}>上传压缩包</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          label="状态"
          name={["status"]}
        >
          <Select
            options={[
              { label: "草稿", value: "draft" },
              { label: "审核中", value: "reviewing" },
              { label: "已通过", value: "approved" },
              { label: "已拒绝", value: "rejected" },
            ]}
          />
        </Form.Item>
      </Form>
    </Create>
  );
};
