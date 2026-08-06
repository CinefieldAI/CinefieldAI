import "server-only";

/**
 * Builds a collision-resistant object path for generation-outputs uploads:
 * <clerk_user_id>/<project_id>/<generation_id>/<unique-file-name>
 */
export function buildOutputStoragePath(
  clerkUserId: string,
  projectId: string,
  generationId: string,
  mimeType: string
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "bin";
  return `${clerkUserId}/${projectId}/${generationId}/${timestamp}-${random}.${ext}`;
}
