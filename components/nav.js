import React from "react";
import { AppBar } from "@mui/material";
import MainAppBar from "./appbar";
import MainDrawer from "./drawer";
import { ThemeProvider } from "@mui/material/styles";
import defaultTheme from "../themes/defaultTheme";
import PropTypes from "prop-types";

function MainNav() {
  return (
    <ThemeProvider theme={defaultTheme}>
      <MainAppBar></MainAppBar>
      <MainDrawer></MainDrawer>
    </ThemeProvider>
  );
}

export default MainNav;
