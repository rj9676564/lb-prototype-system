import { Tag } from "antd";

export const DEFAULT_PROJECT_STATUS = "未上线";

export const projectStatusOptions = [
  { label: "已上线", value: "已上线" },
  { label: "未上线", value: DEFAULT_PROJECT_STATUS },
];

export const ProjectStatusTag = ({ status }: { status?: string }) => {
  const value = status || "已上线";
  return <Tag color={value === "已上线" ? "success" : "processing"}>{value}</Tag>;
};
