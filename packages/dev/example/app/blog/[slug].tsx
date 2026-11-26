import { NotFound, Route } from "@expressive/dev";
import { get } from "@expressive/mvc";

import { served } from "../remote";
import Blog from "./index";

export class Page extends Route {
  blog = get(Blog);
  shown = "";

  async where() {
    this.shown = await served();
  }

  render() {
    const { match, blog, shown, where } = this;
    const slug = match?.slug;
    const known = blog.posts.includes(slug!);
    if (!known) throw new NotFound(`Post ${slug} does not exist.`);

    return (
      <>
        <h1>Post: {slug}</h1>
        <button onClick={where}>Where</button>
        <output>{shown}</output>
      </>
    );
  }
}
