import { Component, get } from "@expressive/mvc";
import { Link } from "@expressive/dev";

import Studio from "./remote";

export class Page extends Component {
  studio = get(Studio);

  render() {
    const { studio } = this;

    return (
      <>
        <h1>Jobs</h1>
        <button onClick={() => studio.start(`job${studio.jobs.size + 1}`)}>Start</button>
        <button onClick={() => studio.slow(1500)}>Slow</button>
        <output>{studio.label}</output>
        <ul>
          {studio.jobs.map(job => (
            <li key={job.id}>
              <Link to={`/jobs/${job.id}`}>{job.id}</Link> <progress value={job.progress} max={5} />
            </li>
          ))}
        </ul>
      </>
    );
  }
}
