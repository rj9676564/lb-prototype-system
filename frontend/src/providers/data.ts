import { DataProvider } from "@refinedev/core";
import { pb } from "../lib/pocketbase";
import { API_URL } from "./constants";

export const dataProvider: DataProvider = {
  getList: async ({ resource, pagination, sorters, filters }) => {
    const { currentPage = 1, pageSize = 10 } = pagination ?? {};
    
    // 构建查询参数
    const queryParams: any = {
      page: currentPage,
      perPage: pageSize,
    };

    // 处理排序
    if (sorters && sorters.length > 0) {
      queryParams.sort = sorters.map(s => `${s.order === 'desc' ? '-' : ''}${s.field}`).join(',');
    }

    // 处理过滤
    let filterStrings: string[] = [];

    // 特定业务逻辑：rp_prototype 仅显示自己创建的，或者是他人已通过（approved）的版本
    // if (resource === "rp_prototype" && pb.authStore.model?.id) {
    //   filterStrings.push(`(creator = "${pb.authStore.model.id}" || status = "approved")`);
    // }

    if (filters && filters.length > 0) {
      for (const filter of filters as any[]) {
        if (!filter.field || filter.value === undefined || filter.value === "") continue;
        
        let val = filter.value;
        if (typeof val === "string") val = val.replace(/"/g, '\\"');
        
        if (filter.field === 'q') {
          // Special search keyword
          if (resource === "rp_project") {
             filterStrings.push(`(name ~ "${val}" || creator.email ~ "${val}")`);
          } else {
             filterStrings.push(`(title ~ "${val}")`);
          }
        } else if (filter.operator === 'eq') {
          filterStrings.push(`${filter.field} = "${val}"`);
        } else if (filter.operator === 'contains') {
          filterStrings.push(`${filter.field} ~ "${val}"`);
        } else if (filter.operator === 'in' || filter.operator === 'or') {
           if (Array.isArray(filter.value)) {
               const mapArr = filter.value.map((v: any) => `${filter.field} = "${v}"`);
               if (mapArr.length > 0) filterStrings.push(`(${mapArr.join(' || ')})`);
           }
        }
      }
    }
    
    if (filterStrings.length > 0) {
      queryParams.filter = filterStrings.join(' && ');
    }

    // 发送请求
    const response = await pb.collection(resource).getList<any>(currentPage, pageSize, queryParams);

    return {
      data: response.items,
      total: response.totalItems,
    };
  },

  getOne: async ({ resource, id }) => {
    const record = await pb.collection(resource).getOne<any>(id as string);
    return { data: record };
  },

  create: async ({ resource, variables }) => {
    try {
      let finalVariables: any;
      
      // 处理 variables，考虑它是 FormData 的特殊情况
      if (variables instanceof FormData) {
        finalVariables = variables;
        if ((resource === "rp_project" || resource === "rp_prototype") && pb.authStore.model?.id) {
          finalVariables.append("creator", pb.authStore.model.id);
        }
      } else {
        finalVariables = { ...variables };
        if ((resource === "rp_project" || resource === "rp_prototype") && pb.authStore.model?.id) {
          // If the user is a superuser, it might fail validation because creator points to users.
          finalVariables.creator = pb.authStore.model.id;
        }
      }

      const record = await pb.collection(resource).create<any>(finalVariables);
      return { data: record };
    } catch (error: any) {
      if (error?.response?.data) {
        // Form field errors from PocketBase
        const msgs = Object.entries(error.response.data).map(([field, err]: any) => `${field}: ${err.message}`).join(', ');
        throw { message: msgs || error.message, statusCode: error.status };
      }
      throw { message: error.message || "Create failed", statusCode: error.status || 500 };
    }
  },

  update: async ({ resource, id, variables }) => {
    try {
      const record = await pb.collection(resource).update<any>(id as string, variables as any);
      return { data: record };
    } catch (error: any) {
      throw { message: error.message || "Update failed", statusCode: error.status || 500 };
    }
  },

  deleteOne: async ({ resource, id }) => {
    await pb.collection(resource).delete(id as string);
    return { data: { id } as any };
  },

  getApiUrl: () => API_URL,
  
  getMany: async ({ resource, ids }) => {
     // 简单实现：循环获取，或者使用 filter 语法
     const promises = ids.map(id => pb.collection(resource).getOne<any>(id as string));
     const results = await Promise.all(promises);
     return { data: results };
  },
};
