import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse
} from 'axios';

export interface RequestProgressCallback {
  (progressEvent: { loaded: number; total?: number; progress?: number }): void;
}

export function formatAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{
      message?: string;
      error?: string;
    }>;
    if (axiosError.response?.data) {
      if (typeof axiosError.response.data === 'string') {
        return axiosError.response.data;
      }
      if (axiosError.response.data.message) {
        return axiosError.response.data.message;
      }
      if (axiosError.response.data.error) {
        return axiosError.response.data.error;
      }
    }
    if (axiosError.message) {
      return axiosError.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const httpClient: AxiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

httpClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    const msg = formatAxiosErrorMessage(error);
    return Promise.reject(new Error(msg));
  }
);

export const http = {
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await httpClient.get<T>(url, config);
    return response.data;
  },

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await httpClient.post<T>(url, data, config);
    return response.data;
  },

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await httpClient.put<T>(url, data, config);
    return response.data;
  },

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await httpClient.delete<T>(url, config);
    return response.data;
  },

  async upload<T>(
    url: string,
    formData: FormData,
    onProgress?: RequestProgressCallback,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await httpClient.post<T>(url, formData, {
      ...config,
      headers: {
        ...config?.headers,
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: onProgress
        ? (progressEvent) => {
            onProgress({
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              progress: progressEvent.total
                ? progressEvent.loaded / progressEvent.total
                : undefined
            });
          }
        : undefined
    });
    return response.data;
  }
};
