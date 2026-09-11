import animalRossingImage from "@/assets/templates/animal-rossing.webp";
import doodleAvatarImage from "@/assets/templates/doodle-avatar.webp";

export type ImageGenerationTemplate = {
  id: string;
  name: string;
  description: string;
  image: string;
  prompt: string;
};

export const IMAGE_GENERATION_TEMPLATES: ImageGenerationTemplate[] = [
  {
    id: "animal-crossing-portrait",
    name: "动物森友会肖像",
    description: "柔和、可爱的 3D 立体角色照片",
    image: animalRossingImage,
    prompt:
      "生成一张动物森友会风格的照片，人物头部占画面约三分之一，整体拥有柔和可爱的色彩、细腻的材质和明显的 3D 立体质感。",
  },
  {
    id: "doodle-avatar",
    name: "彩色涂鸦头像",
    description: "自由变形、即兴手绘的彩色速写效果",
    image: doodleAvatarImage,
    prompt:
      "以彩色涂鸦速写风表现【图中角色】，仅露出上半身，整体呈现快速勾勒、自由变形、即兴手绘与草稿式的视觉效果。线条随手、夸张、可粗细不一，略显凌乱但具有节奏和表现力……",
  },
];
