// Simple utility to merge class names
export function cn(...inputs: (string | undefined | null)[]): string {
  return inputs.filter(Boolean).join(' ');
} 