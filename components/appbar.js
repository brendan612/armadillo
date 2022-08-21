import { AppBar, IconButton, Toolbar, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { ThemeProvider } from "@mui/material/styles";
import defaultTheme from "../themes/defaultTheme";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { setOpen } from "../slices/drawerSlice";

export default function MainAppBar(props) {
  const dispatch = useDispatch();
  return (
    <ThemeProvider theme={defaultTheme}>
      <AppBar position="sticky">
        <Toolbar>
          <IconButton>
            <MenuIcon
              onClick={() => {
                dispatch(setOpen(true));
              }}
            />
          </IconButton>
          <Typography variant="h6">Armadillo</Typography>
        </Toolbar>
      </AppBar>
    </ThemeProvider>
  );
}
