import {
  ContentTypeHeader,
  JSONResponseType,
  LocationHeader,
  redirect,
  XSolidStartContentTypeHeader,
  XSolidStartOrigin,
  XSolidStartResponseTypeHeader
} from "../responses";
import { FETCH_EVENT } from "../types";

import { FormError } from "../../data";
import { ServerError } from "../../data/FormError";
import { CreateServerFunction, ServerFunction } from "./types";

export async function parseResponse(request: Request, response: Response) {
  const contentType =
    response.headers.get(XSolidStartContentTypeHeader) ||
    response.headers.get(ContentTypeHeader) ||
    "";
  if (contentType.includes("json")) {
    return await response.json();
  } else if (contentType.includes("text")) {
    return await response.text();
  } else if (contentType.includes("server-error")) {
    const data = await response.json();
    return new ServerError(data.error.message, {
      stack: data.error.stack,
      status: response.status
    });
  } else if (contentType.includes("form-error")) {
    const data = await response.json();
    return new FormError(data.error.message, {
      fieldErrors: data.error.fieldErrors,
      fields: data.error.fields,
      stack: data.error.stack
    });
  } else if (contentType.includes("error")) {
    const data = await response.json();
    const error = new Error(data.error.message);
    if (data.error.stack) {
      error.stack = data.error.stack;
    }
    return error;
  } else if (contentType.includes("response")) {
    if (response.status === 204 && response.headers.get(LocationHeader)) {
      return redirect(response.headers.get(LocationHeader)!);
    }
    return response;
  } else {
    if (response.status === 200) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {}
    }
    if (response.status === 204 && response.headers.get(LocationHeader)) {
      return redirect(response.headers.get(LocationHeader)!);
    }
    return response;
  }
}

export const server$ = ((_fn: any) => {
  throw new Error("Should be compiled away");
}) as unknown as CreateServerFunction;

function createRequestInit(...args: any[]): RequestInit {
  // parsing args when a request is made from the browser for a server module
  // FormData
  // Request
  // Headers
  //
  let body,
    headers: Record<string, string> = {
      [XSolidStartOrigin]: "client"
    };

  if (args[0] instanceof FormData) {
    body = args[0];
  } else {
    // special case for when server is used as fetcher for createResource
    // we set {}.value to undefined. This keeps the createResource API intact as the type
    // of this object is { value: T | undefined; refetching: boolean }
    // So the user is expected to check value for undefined, and by setting it as undefined
    // we can match user expectations that they dont have access to previous data on
    // the server
    if (Array.isArray(args) && args.length > 2) {
      let secondArg = args[1];
      if (typeof secondArg === "object" && "value" in secondArg && "refetching" in secondArg) {
        secondArg.value = undefined;
      }
    }
    body = JSON.stringify(args, (key, value) => {
      if (value && typeof value === "object" && value.$type === FETCH_EVENT) {
        return {
          $type: "fetch_event"
        };
      }
      if (value instanceof Headers) {
        return {
          $type: "headers",
          values: [...value.entries()]
        };
      }
      if (value instanceof Request) {
        return {
          $type: "request",
          url: value.url,
          method: value.method,
          headers: value.headers
        };
      }
      return value;
    });
    headers[ContentTypeHeader] = JSONResponseType;
  }

  return {
    method: "POST",
    body: body,
    headers: new Headers({
      ...headers
    })
  };
}

type ServerCall = (route: string, init: RequestInit) => Promise<Response>;

server$.createFetcher = route => {
  let fetcher: any = function (this: Request, ...args: any[]) {
    if (this instanceof Request) {
    }
    const requestInit = createRequestInit(...args);
    // request body: json, formData, or string
    return (server$.call as ServerCall)(route, requestInit);
  };

  fetcher.url = route;
  fetcher.fetch = (init: RequestInit) => (server$.call as ServerCall)(route, init);
  // fetcher.action = async (...args: any[]) => {
  //   const requestInit = createRequestInit(...args);
  //   // request body: json, formData, or string
  //   return server$.call(route, requestInit);
  // };
  return fetcher as ServerFunction<any, any>;
};

server$.call = async function (route: string, init: RequestInit) {
  const request = new Request(new URL(route, window.location.href).href, init);

  const response = await fetch(request);

  // // throws response, error, form error, json object, string
  if (response.headers.get(XSolidStartResponseTypeHeader) === "throw") {
    throw await parseResponse(request, response);
  } else {
    return await parseResponse(request, response);
  }
} as any;

// used to fetch from an API route on the server or client, without falling into
// fetch problems on the server
server$.fetch = async function (route: string | URL, init: RequestInit) {
  if (route instanceof URL || route.startsWith("http")) {
    return await fetch(route, init);
  }
  const request = new Request(new URL(route, window.location.href).href, init);
  return await fetch(request);
};
