import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const query = url.searchParams.toString();

  return redirect(query ? `/app?${query}` : "/app");
};

export default function Index() {
  return null;
}
