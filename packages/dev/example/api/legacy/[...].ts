const legacy = (request: Request) => Response.json({ legacy: new URL(request.url).pathname, method: request.method });

export default () => legacy;
