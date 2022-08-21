import React from "react";
import Button from "@mui/material/Button";
import SaveIcon from "@mui/icons-material/Save";
import TrashIcon from "@mui/icons-material/Delete";
import {
  ButtonGroup,
  FormControlLabel,
  TextField,
  Container,
  Paper,
  Grid,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import Head from "next/head";
import { Checkbox } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import defaultTheme from "../../themes/defaultTheme";
import { Typography } from "@mui/material";
import Grid2 from "@mui/material/Unstable_Grid2";
import Fab from "@mui/material/Fab";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";

const Item = styled(Paper)(({ theme }) => ({
  backgroundColor: theme.palette.secondary,
  ...theme.typography.body2,
  padding: theme.spacing(1),
  textAlign: "center",
  color: theme.palette.primary.main,
}));

const fabStyle = {
  top: "auto",
  right: 20,
  bottom: 20,
  left: "auto",
  position: "fixed",
  margin: 0,
};

const deleteStyles = {
  position: "absolute",
  top: "auto",
  right: 30,
  bottom: "auto",
  left: "auto",
};

export default function Dashboard() {
  let initialItems = [];
  const [items, setItems] = React.useState(initialItems);

  function createPasswordItem() {
    setItems((items) => [...items, items.length + 1 + ""]);
  }

  function deletePasswordItem(text) {
    console.log(items);
    const newItems = items.filter(function (e) {
      return e !== text;
    });
    console.log(newItems);
    setItems(newItems);
  }

  return (
    <ThemeProvider theme={defaultTheme}>
      <Head>
        <title>Dashboard - Armadillo</title>
      </Head>
      <Container maxWidth="100%">
        <Grid2
          id="password-grid"
          spacing={2}
          container
          justifyContent="center"
          style={{ marginTop: 5 }}
        >
          {items.map((text) => (
            <React.Fragment key={text}>
              <Grid2 xs={12} lg={12}>
                <Item color="primary" position="relative">
                  <Typography style={{ paddingBottom: 10 }}>
                    Item {text}
                    <Button
                      style={deleteStyles}
                      variant="contained"
                      color="secondary"
                      onClick={() => {
                        deletePasswordItem(text);
                      }}
                    >
                      <DeleteIcon />
                    </Button>
                  </Typography>
                </Item>
              </Grid2>
            </React.Fragment>
          ))}
        </Grid2>
      </Container>
      <Fab color="primary" aria-label="add" style={fabStyle}>
        <AddIcon onClick={createPasswordItem} />
      </Fab>
    </ThemeProvider>
  );
}
