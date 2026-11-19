import { z } from "zod";

// 048 EARS-25 (#3994) — the subset of the Bot API `Update` the poller reads
// (https://core.telegram.org/bots/api#update). The message object stays loose
// so the mapping can see a key it must drop on (a poll, a forward, a service
// field); only the fields named here are ever read, and nothing of the raw
// update is stored or logged (EARS-36).

const PhotoSizeSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  file_size: z.number().int().nonnegative().optional(),
});
export type TelegramPhotoSize = z.infer<typeof PhotoSizeSchema>;

const VideoSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative(),
  thumbnail: PhotoSizeSchema.optional(),
});

export const TelegramMessageSchema = z.looseObject({
  message_id: z.number().int().positive(),
  date: z.number().int().nonnegative(),
  chat: z.object({
    id: z.number().int(),
    type: z.string(),
    username: z.string().optional(),
  }),
  media_group_id: z.string().min(1).max(256).optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(z.unknown()).optional(),
  photo: z.array(PhotoSizeSchema).min(1).optional(),
  video: VideoSchema.optional(),
  forward_origin: z.unknown().optional(),
});
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>;

export const TelegramUpdateSchema = z.looseObject({
  update_id: z.number().int().nonnegative(),
  channel_post: TelegramMessageSchema.optional(),
  edited_channel_post: TelegramMessageSchema.optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
