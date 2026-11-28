import { Link, Redirect, Route } from "@expressive/dev";

export function Page() {
  return (
    <Route>
      <Route to="claim" as={Claim} />
      <Route none as={() => { throw new Redirect("/desk/claim"); }} />
    </Route>
  );
}

function Claim() {
  return (
    <>
      <h1>Claim</h1>
      <Link to="/desk/report">File a report</Link>
    </>
  );
}
