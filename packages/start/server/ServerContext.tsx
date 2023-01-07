import { PageEvent } from "./types";

import { createContext, useContext } from "solid-js";

export const ServerContext = createContext<PageEvent>({} as any);

export const useRequest = () => {
  return useContext(ServerContext)!;
};

export const useServerContext = () => {
  throw new Error("useServerContext is deprecated. Use useRequest instead.");
};
