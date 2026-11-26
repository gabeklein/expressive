import { Model } from "@expressive/mvc";
import { NotFound } from "@expressive/dev";

export default class Blog extends Model {
  posts = ["hello", "world"];
}

export function Page() {
  const { posts } = Blog.get();

  return (
    <>
      <h1>Blog index</h1>
      <ul>
        {posts.map(post => <li key={post}>{post}</li>)}
      </ul>
    </>
  );
}

export function Catch({ error, retry }: { error: Error; retry: () => void }) {
  return <section role="alert">{error instanceof NotFound ? "Blog post not found" : error.message} <button onClick={retry}>Retry</button></section>;
}
