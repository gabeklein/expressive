import { Component } from "@expressive/mvc";
import { Link, NotFound } from "@expressive/dev";

export function Layout(props: { children?: Component.Node }) {
  return (
    <main>
      <nav>
        <Link to="/">Home</Link> {" | "}
        <Link to="/blog">Blog</Link> {" | "}
        <Link to="/blog/hello">Hello post</Link> {" | "}
        <Link to="/blog/missing">Missing post</Link> {" | "}
        <Link to="/about">About</Link> {" | "}
        <Link to="/tally">Tally</Link> {" | "}
        <Link to="/gate">Gate</Link> {" | "}
        <Link to="/room/1">Room 1</Link> {" | "}
        <Link to="/room/locked">Locked room</Link> {" | "}
        <Link to="/room/old">Old room</Link> {" | "}
        <Link to="/room/moved">Moved room</Link> {" | "}
        <Link to="/note/7">Note 7</Link>
      </nav>
      {props.children}
    </main>
  );
}

export class Page extends Component {
  count = 0;

  render() {
    const { count, is } = this;

    return (
      <>
        <h1>Home</h1>
        <button onClick={() => is.count++}>Clicked {count} times</button>
      </>
    );
  }
}

export function Loading() {
  return <p>Loading…</p>;
}

export function Catch({ error, retry }: { error: Error; retry: () => void }) {
  if (error instanceof NotFound) return <h1>404</h1>;
  return (
    <p role="alert">
      Something broke: {error.message} <button onClick={retry}>Retry</button>
    </p>
  );
}
