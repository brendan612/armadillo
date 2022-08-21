import "../styles/globals.css";
import Head from "next/head";
import { ThemeProvider } from "@mui/material/styles";
import MainNav from "../components/nav.js";
import theme from "../themes/defaultTheme";
import Box from "@mui/material/Box";
import MainDrawer from "../components/drawer";
import { store } from "../store";
import { Provider } from "react-redux";

function MyApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <div>
          <Head>
            <title>Home - Armadillo</title>
            <meta
              name="viewport"
              content="initial-scale=1, width=device-width"
            />
          </Head>
          <Box>
            <MainNav />
            <Component {...pageProps} />
          </Box>
        </div>
      </ThemeProvider>
    </Provider>
  );
}

export default MyApp;
