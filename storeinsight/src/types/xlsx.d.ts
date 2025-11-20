/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "xlsx/xlsx.mjs" {
  import type * as XLSXTypes from "xlsx";

  interface XlsxModule {
    read: typeof XLSXTypes.read;
    set_cptable: (cptable: unknown) => void;
    utils: typeof XLSXTypes.utils;
    [key: string]: unknown;
  }

  const xlsx: XlsxModule;
  export = xlsx;
}

declare module "xlsx/dist/cpexcel.full.mjs" {
  const cpexcel: unknown;
  export = cpexcel;
}
