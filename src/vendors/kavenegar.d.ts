declare module '*/vendors/kavenegar' {
  export function KavenegarApi(options: { apikey: string }): {
    VerifyLookup(
      params: {
        receptor: string;
        token?: string;
        token2?: string;
        token3?: string;
        template: string;
        type?: string;
      },
      cb: (entries: any, status: number, message?: any) => void
    ): void;

    Send(
      params: { receptor: string; message: string; sender?: string },
      cb: (entries: any, status: number, message?: any) => void
    ): void;
  };
}
