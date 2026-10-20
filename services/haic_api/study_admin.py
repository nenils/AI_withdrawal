"""Private VM-only recovery actions; never exposed as web endpoints."""
import argparse
import urllib.parse

from withdrawal_store import WithdrawalStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['release-browser'])
    parser.add_argument('--participant-id', required=True)
    args = parser.parse_args()
    store = WithdrawalStore()
    if not store.persistent:
        parser.error('Supabase credentials are required')
    participant = urllib.parse.quote(args.participant_id, safe='')
    store._request('DELETE', f'withdrawal_participant_access?participant_id=eq.{participant}', prefer='return=minimal')
    print('Browser binding released; game progress and questionnaire data were not changed.')
    print('Ask the participant to reopen their private SONA link immediately in the intended browser.')


if __name__ == '__main__':
    main()
