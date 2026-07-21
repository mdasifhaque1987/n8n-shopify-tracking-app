import "../styles/action-buttons.css";
/* global process */
import {
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* Hidden home target used by the DH Conversions app name */}
        <s-link href="/app" rel="home">
          Home
        </s-link>

        {/* Visible Home navigation item */}
        <s-link href="/app/home">
          Home
        </s-link>

        <s-link href="/app/settings">
          Configuration
        </s-link>

        <s-link href="/app/connections">
          Connections
        </s-link>

        <s-link href="/app/subscription">
          My Subscription
        </s-link>
      </s-app-nav>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
