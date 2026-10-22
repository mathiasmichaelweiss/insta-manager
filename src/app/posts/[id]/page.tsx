import { PostView } from "@/components/PostView";

export const metadata = { title: "Пост · Insta Manager" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostView id={id} />;
}
