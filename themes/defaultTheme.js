import { createTheme } from "@mui/material/styles";

const defaultTheme = createTheme({
  typography: {
    h3: {
      // fontSize: 36,
    },
  },
  palette: {
    primary: {
      light: "#52c7b8",
      main: "#009688",
      dark: "#00675b",
      contrastText: "#000",
    },
    secondary: {
      light: "#ffaf4c",
      main: "#f47e17",
      dark: "#bb5000",
      contrastText: "#000",
    },
    mode: "dark",
  },
});

export default defaultTheme;
