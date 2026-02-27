import PocketBase from 'pocketbase';
import { BASE_URL } from '../providers/constants';

export const pb = new PocketBase(BASE_URL);

// 禁用 PocketBase 的自动取消机制，避免 Refine 频繁发出的并行查询被强制中断
pb.autoCancellation(false);
