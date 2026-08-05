/**
 * Shared constraints for uploads to the generation-inputs Storage bucket.
 * Mirrors the RLS-enforced limits already configured server-side.
 */
export const ALLOWED_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
];

export const MAX_INPUT_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Builds a collision-resistant object path for generation-inputs uploads:
 * <clerk_user_id>/<project_id>/<unique-file-name>
 */
export function buildInputStoragePath(
  clerkUserId: string,
  projectId: string,
  originalFileName: string
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const dotIndex = originalFileName.lastIndexOf(".");
  const ext =
    dotIndex > -1 ? originalFileName.slice(dotIndex + 1).toLowerCase() : "bin";
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
  return `${clerkUserId}/${projectId}/${timestamp}-${random}.${safeExt}`;
}
