import "../styles/globals.css";
import Head from "next/head";
import { ThemeProvider } from "@mui/material/styles";
import AppBar from "../components/appbar.js";
import Drawer from "../components/nav.js";
import theme from "../themes/defaultTheme";

function MyApp({ Component, pageProps }) {
  return (
    <ThemeProvider theme={theme}>
      <div>
        <Head>
          <title>Home - Armadillo</title>
          <meta name="viewport" content="initial-scale=1, width=device-width" />
        </Head>
        <Drawer></Drawer>
        <Component {...pageProps} />
      </div>
    </ThemeProvider>
  );
}

export default MyApp;
