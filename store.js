import { configureStore } from "@reduxjs/toolkit";
import drawerReducer from "./slices/drawerSlice";

export const store = configureStore({
  reducer: { drawerState: drawerReducer },
});
