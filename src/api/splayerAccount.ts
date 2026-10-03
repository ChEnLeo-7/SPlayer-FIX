import type {
  SPlayerApiErrorResponse,
  SPlayerAuthResponse,
  SPlayerLoginRequest,
  SPlayerPasswordRequest,
  SPlayerRegisterRequest,
  SPlayerSessionResponse,
  SPlayerVaultResponse,
  SPlayerVaultUpdateRequest,
} from "@/types/account";
import axios from "axios";

const accountRequest = axios.create({
  baseURL: "/api/splayer",
  timeout: 15000,
  withCredentials: true,
});

export const getSPlayerApiErrorMessage = (error: unknown): string | undefined => {
  if (!axios.isAxiosError(error)) return undefined;
  const response = error.response?.data as Partial<SPlayerApiErrorResponse> | undefined;
  return response?.error?.message;
};

export const registerSPlayerAccount = (data: SPlayerRegisterRequest) =>
  accountRequest.post<SPlayerAuthResponse>("/register", data).then((response) => response.data);

export const loginSPlayerAccount = (data: SPlayerLoginRequest) =>
  accountRequest.post<SPlayerAuthResponse>("/login", data).then((response) => response.data);

export const getSPlayerSession = () =>
  accountRequest.get<SPlayerSessionResponse>("/session").then((response) => response.data);

export const logoutSPlayerAccount = () => accountRequest.post<void>("/logout");

export const changeSPlayerPassword = (data: SPlayerPasswordRequest) =>
  accountRequest.post<SPlayerAuthResponse>("/password", data).then((response) => response.data);

export const getSPlayerVault = () =>
  accountRequest.get<SPlayerVaultResponse>("/vault").then((response) => response.data);

export const updateSPlayerVault = (data: SPlayerVaultUpdateRequest) =>
  accountRequest.put<SPlayerVaultResponse>("/vault", data).then((response) => response.data);
