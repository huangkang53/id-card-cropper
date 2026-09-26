// EXPORTS: Point2D, Quality, ICardRecord, IStats

/** 图片坐标系下的一个点（像素） */
export interface Point2D {
  x: number;
  y: number;
}

/** 质量标记：null=未评审，'good'=合格，'poor'=质量不行 */
export type Quality = 'good' | 'poor' | null;

/** 一张身份证照片的记录（元数据，与本地后端一致） */
export interface ICardRecord {
  id: string;
  /** 原始文件名 */
  name: string;
  /** 原图宽高（像素） */
  width: number;
  height: number;
  /** 四个角在原图坐标系中的位置（左上/右上/右下/左下）；null=尚未设置 */
  corners: Point2D[] | null;
  /** 第二组四角（一张图里有正反两面时） */
  corners2?: Point2D[] | null;
  /** 编辑器选择的顺时针旋转角度：0/90/180/270；保存时后端据此转正原图 */
  rotation?: number;
  /** 是否已生成透视裁剪结果 */
  hasCrop: boolean;
  quality: Quality;
  createdAt: number;
  updatedAt: number;
}

/** 列表统计 */
export interface IStats {
  total: number;
  pending: number;
  cropped: number;
  good: number;
  poor: number;
}
