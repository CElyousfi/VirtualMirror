import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Virtual Mirror</h1>
        <p className={styles.text}>
          Live 3D eyewear try-on for your Shopify store.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Your own frames</strong>. Prepare your eyewear products as 3D frames from inside Shopify.
          </li>
          <li>
            <strong>Live on the product page</strong>. Shoppers try frames on through their camera, with no app to install.
          </li>
          <li>
            <strong>Private by design</strong>. The camera feed stays on the shopper&apos;s device.
          </li>
        </ul>
      </div>
    </div>
  );
}
