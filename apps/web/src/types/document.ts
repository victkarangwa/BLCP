export interface DocumentListItem {
  id: string;
  documentType: string;
  version: number;
  totalVersions: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; fullName: string };
}
