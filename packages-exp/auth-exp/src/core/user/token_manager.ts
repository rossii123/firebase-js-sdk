/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { requestStsToken } from '../../api/authentication/token';
import { Auth } from '../../model/auth';
import { IdTokenResponse } from '../../model/id_token';
import { AUTH_ERROR_FACTORY, AuthErrorCode } from '../errors';
import { PersistedBlob } from '../persistence';
import { assert } from '../util/assert';

/**
 * The number of milliseconds before the official expiration time of a token
 * to refresh that token, to provide a buffer for RPCs to complete.
 */
export const TOKEN_REFRESH_BUFFER_MS = 30_000;

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
}

export class StsTokenManager {
  refreshToken: string | null = null;
  accessToken: string | null = null;
  expirationTime: number | null = null;

  get isExpired(): boolean {
    return (
      !this.expirationTime ||
      Date.now() > this.expirationTime - TOKEN_REFRESH_BUFFER_MS
    );
  }

  updateFromServerResponse({
    idToken,
    refreshToken,
    expiresIn: expiresInSec
  }: IdTokenResponse): void {
    this.refreshToken = refreshToken;
    this.accessToken = idToken;
    this.expirationTime = Date.now() + Number(expiresInSec) * 1000;
  }

  async getToken(auth: Auth, forceRefresh = false): Promise<Tokens|null> {
    if (!forceRefresh && this.accessToken && !this.isExpired) {
      return this.tokens;
    }

    if (this.accessToken && !this.refreshToken) {
      throw AUTH_ERROR_FACTORY.create(AuthErrorCode.TOKEN_EXPIRED, {
        appName: auth.name,
      });
    }

    if (!this.refreshToken) {
      return null;
    }

    await this.refresh(auth, this.refreshToken);
    return this.tokens;
  }

  toPlainObject(): object {
    return {
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      expirationTime: this.expirationTime
    };
  }

  private get tokens(): Tokens {
    return {
      accessToken: this.accessToken!,
      refreshToken: this.refreshToken,
    };
  }

  private async refresh(auth: Auth, refreshToken: string) {
    const {access_token, refresh_token, expires_in} = await requestStsToken(auth, refreshToken);
    
    this.accessToken = access_token || null;
    this.refreshToken = refresh_token || null;
    this.expirationTime = expires_in ? Date.now() + Number(expires_in) * 1000 : null;
  }

  static fromPlainObject(
    appName: string,
    object: PersistedBlob
  ): StsTokenManager {
    const { refreshToken, accessToken, expirationTime } = object;

    const manager = new StsTokenManager();
    if (refreshToken) {
      assert(typeof refreshToken === 'string', appName);
      manager.refreshToken = refreshToken;
    }
    if (accessToken) {
      assert(typeof accessToken === 'string', appName);
      manager.accessToken = accessToken;
    }
    if (expirationTime) {
      assert(typeof expirationTime === 'number', appName);
      manager.expirationTime = expirationTime;
    }
    return manager;
  }

  // TODO: There are a few more methods in here that need implemented:
  //    # toPlainObject
  //    # fromPlainObject
  //    # (private) performRefresh
}
