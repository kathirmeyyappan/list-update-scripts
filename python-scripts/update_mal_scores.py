# self note: cred info is in AnimeListUpdate project in gcloud console

import os
import dotenv
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import requests
import re
from time import sleep
from colorama import Fore, Style

dotenv.load_dotenv()

# connect to Google Sheets
scope = ['https://spreadsheets.google.com/feeds',
         'https://www.googleapis.com/auth/drive']
creds = ServiceAccountCredentials.from_json_keyfile_name('../credentials.json', scope)
client = gspread.authorize(creds)

# accessing relevant tab in sheet
sheet_key = os.getenv('SHEET_KEY')
sheet = client.open_by_key(sheet_key).worksheet('Anime List (Statistics Version)')

# MAL auth
mal_client_id = os.getenv('MAL_CLIENT_ID')
mal_auth = {'X-MAL-CLIENT-ID' : mal_client_id}

# arrays for use, cmp, and update
urls = [url for url in sheet.col_values(13)[1:]]
old_scores = [0 if not n else float(n) for n in sheet.col_values(7)[1:]]
new_scores = []
anime_names = sheet.col_values(3)[1:]
updates = []
score_map = {}


# function to get the score of the anime with given id
def get_mal_rating(anime_id):
    base_url = "https://api.myanimelist.net/v2/anime"
    response = requests.get(f'{base_url}/{anime_id}?fields=,mean', 
                            headers=mal_auth).json()
    return response['mean']


# initial MAL API call
url = "https://api.myanimelist.net/v2/users/Uji_Gintoki_Bowl/animelist?fields=,mean"
payload = {'limit': 500,
           'offset': 0,
           'fields': 'id, mean'}
response = requests.get(url, headers=mal_auth, params=payload).json()

# populate score_map to cache scores and avoid 100s of calls
while True:
    
    for obj in response['data']:
        entry = obj['node']
        id = str(entry['id'])
        score = entry.get('mean', 'NA')
        score_map[id] = score
    
    if 'next' not in response['paging']:
        break
    response = requests.get(response['paging']['next'], headers=mal_auth).json()
    
    
# make new_scores
for i, url in enumerate(urls):
    
    id = re.search(r'/anime/(\d+)/?', url).group(1)
    new_score = get_mal_rating(id) if id not in score_map else score_map[id]
    new_scores.append(new_score)
    old_score = 0 if i >= len(old_scores) else old_scores[i]
    
    if (old_score != new_score):
        anime_name = anime_names[i]
        updates.append((anime_name, old_score, new_score))

# print updates
if not updates:
    print("\nNO UPDATES")
for i, update in enumerate(updates):
    if i == 0:
        print("\nUPDATES:\n")
    anime_name, old_score, new_score = update
    sp = max(80 - len(anime_name), 0)
    color = Fore.GREEN if new_score > old_score else Fore.RED
    print(color + f"{anime_name}{' ' * sp} {old_score} -> {new_score}" + \
          Style.RESET_ALL)
print()

# sync to MAL rating column in sheet
mal_rating_column = sheet.range(f'G2:G{2 + len(new_scores) - 1}')
for i, cell in enumerate(mal_rating_column):
    cell.value = new_scores[i]
sheet.update_cells(mal_rating_column)
