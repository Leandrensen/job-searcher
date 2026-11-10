export interface HttpClient {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}
